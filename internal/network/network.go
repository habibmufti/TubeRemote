package network

import (
	"net"
)

// LocalIP returns the best local IPv4 address, preferring RFC1918 LAN addresses
// over VPN/Tailscale addresses (100.x.x.x CGNAT range).
func LocalIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}

	var lanIP, fallbackIP string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip4 := ip.To4()
			if ip4 == nil {
				continue
			}
			if isRFC1918(ip4) {
				if lanIP == "" {
					lanIP = ip4.String()
				}
			} else if fallbackIP == "" {
				fallbackIP = ip4.String()
			}
		}
	}

	if lanIP != "" {
		return lanIP
	}
	if fallbackIP != "" {
		return fallbackIP
	}
	return "127.0.0.1"
}

func isRFC1918(ip net.IP) bool {
	private := []struct{ a, b byte }{
		{10, 0},
		{172, 16},
		{192, 168},
	}
	for _, p := range private {
		if ip[0] == p.a {
			if p.a == 172 {
				return ip[1] >= 16 && ip[1] <= 31
			}
			if p.a == 10 {
				return true
			}
			return ip[1] == p.b
		}
	}
	return false
}
