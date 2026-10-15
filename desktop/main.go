package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
)

//go:embed site
var site embed.FS

func open(url string) {
	if runtime.GOOS == "windows" {
		// Edge app mode gives a standalone window; fall back to the default browser.
		if exec.Command("cmd", "/c", "start", "", "msedge", "--app="+url).Run() == nil {
			return
		}
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		return
	}
	exec.Command("xdg-open", url).Start()
}

func main() {
	root, _ := fs.Sub(site, "site")
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	url := fmt.Sprintf("http://%s/", ln.Addr())
	fmt.Println("World Simulation running at", url)
	fmt.Println("Close this window to quit.")
	go open(url)
	http.Serve(ln, http.FileServer(http.FS(root)))
}
