package main

import (
	"fmt"
	"mth-blog-editor/launcher/internal/thumbnail"
	"os"
)

func main() {
	if err := thumbnail.Write(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
