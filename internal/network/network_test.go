package network

import (
	"net"
	"testing"
)

func TestRFC1918Rank(t *testing.T) {
	cases := []struct {
		ip   string
		want int
	}{
		{"192.168.1.20", 2}, // home LAN — preferred
		{"10.0.0.5", 1},     // corp LAN
		{"172.29.18.17", 0}, // WSL/Docker squat range — lowest
		{"172.16.0.1", 0},
		{"172.31.255.1", 0},
		{"8.8.8.8", -1},      // public
		{"172.15.0.1", -1},   // just below the 172.16/12 range
		{"172.32.0.1", -1},   // just above
		{"100.64.0.1", -1},   // CGNAT/Tailscale
	}
	for _, c := range cases {
		got := rfc1918Rank(net.ParseIP(c.ip).To4())
		if got != c.want {
			t.Errorf("rfc1918Rank(%s) = %d, want %d", c.ip, got, c.want)
		}
	}
}

func TestIsVirtualAdapter(t *testing.T) {
	virtual := []string{
		"vEthernet (WSL)", "vEthernet (Default Switch)", "docker0",
		"br-1a2b3c", "veth1234", "virbr0", "vmnet8", "vboxnet0",
		"tailscale0", "utun3", "tun0", "wg0", "ztabc123",
	}
	for _, n := range virtual {
		if !isVirtualAdapter(n) {
			t.Errorf("isVirtualAdapter(%q) = false, want true", n)
		}
	}

	real := []string{"eth0", "en0", "wlan0", "Wi-Fi", "Ethernet", "enp3s0"}
	for _, n := range real {
		if isVirtualAdapter(n) {
			t.Errorf("isVirtualAdapter(%q) = true, want false", n)
		}
	}
}
