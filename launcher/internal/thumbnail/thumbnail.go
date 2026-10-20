// Package thumbnail creates small previews without external image tools.
package thumbnail

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	_ "github.com/gen2brain/avif"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const MaxEdge = 112

func Write(input io.Reader, output io.Writer) error {
	data, err := io.ReadAll(io.LimitReader(input, 60_000_001))
	if err != nil {
		return err
	}
	if len(data) > 60_000_000 {
		return fmt.Errorf("a imagem excede 60 MB")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("imagem inválida: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 100_000_000 {
		return fmt.Errorf("a imagem excede 100 megapixels")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return err
	}
	w, h := source.Bounds().Dx(), source.Bounds().Dy()
	if w > MaxEdge || h > MaxEdge {
		if w >= h {
			h = max(1, h*MaxEdge/w)
			w = MaxEdge
		} else {
			w = max(1, w*MaxEdge/h)
			h = MaxEdge
		}
	}
	result := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(result, result.Bounds(), image.NewUniform(color.RGBA{250, 248, 245, 255}), image.Point{}, draw.Src)
	draw.ApproxBiLinear.Scale(result, result.Bounds(), source, source.Bounds(), draw.Over, nil)
	return jpeg.Encode(output, orient(result, orientation(data)), &jpeg.Options{Quality: 72})
}
