package network

import (
	"net"
	"strings"
)

// LocalIP returns the best local IPv4 address for reaching this machine from a
// phone on the same network. It prefers the interface that holds the default
// route (the real LAN/WiFi adapter), falling back to an interface scan that
// skips virtual adapters (WSL, Hyper-V, Docker, VPNs).
func LocalIP() string {
	if ip := outboundIP(); ip != "" {
		return ip
	}
	if ip := scanInterfaces(); ip != "" {
		return ip
	}
	return "127.0.0.1"
}

// outboundIP asks the OS which local address it would use to reach an external
// host. No packets are sent — connecting a UDP socket only resolves the route —
// so this works offline as long as a default route exists. This naturally
// returns the real LAN adapter and skips WSL/Docker/Hyper-V virtual interfaces,
// which don't carry the default route.
func outboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()

	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil {
		return ""
	}
	ip4 := addr.IP.To4()
	if ip4 == nil || ip4.IsLoopback() {
		return ""
	}
	return ip4.String()
}

// scanInterfaces is a fallback when no default route exists. It prefers
// RFC1918 LAN addresses over VPN/CGNAT addresses, skips known virtual adapters,
// and ranks subnets 192.168.x > 10.x > 172.16-31.x since virtual adapters
// commonly squat on the 172.16/12 range.
func scanInterfaces() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	var best string
	bestRank := -1
	var fallbackIP string

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if isVirtualAdapter(iface.Name) {
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
			if r := rfc1918Rank(ip4); r >= 0 {
				if r > bestRank {
					bestRank = r
					best = ip4.String()
				}
			} else if fallbackIP == "" {
				fallbackIP = ip4.String()
			}
		}
	}

	if best != "" {
		return best
	}
	return fallbackIP
}

// isVirtualAdapter reports whether an interface name belongs to a virtual
// adapter that a phone on the LAN can't reach (WSL, Hyper-V, Docker, VMs, VPNs).
func isVirtualAdapter(name string) bool {
	n := strings.ToLower(name)
	prefixes := []string{
		"vethernet", // Windows: WSL2, Hyper-V, Docker virtual switches
		"docker",    // Linux: docker0
		"br-",       // Linux: docker/bridge networks
		"veth",      // Linux: container veth pairs
		"virbr",     // Linux: libvirt
		"vmnet",     // VMware
		"vboxnet",   // VirtualBox
		"tailscale", // Tailscale
		"utun",      // macOS VPN tunnels
		"tun",       // generic VPN tunnels
		"tap",       // generic VPN taps
		"zt",        // ZeroTier
		"wg",        // WireGuard
	}
	for _, p := range prefixes {
		if strings.HasPrefix(n, p) {
			return true
		}
	}
	return false
}

// rfc1918Rank returns a preference rank for private IPv4 ranges, or -1 if the
// address is not RFC1918. Higher is better. 192.168/16 is the most common home
// LAN range, so it wins; 172.16/12 ranks lowest because virtual adapters squat
// there.
func rfc1918Rank(ip net.IP) int {
	switch {
	case ip[0] == 192 && ip[1] == 168:
		return 2
	case ip[0] == 10:
		return 1
	case ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31:
		return 0
	default:
		return -1
	}
}
