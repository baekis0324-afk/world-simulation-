#!/bin/sh
# Bundles the site files and cross-compiles a Windows exe.
set -e
cd "$(dirname "$0")"
rm -rf site && mkdir site
cp ../index.html ../privacy.html ../site.json ../i18n.json ../map.json ../elev.txt ../grid.txt ../plates.txt ../preview.png site/
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o WorldSimulation.exe .
