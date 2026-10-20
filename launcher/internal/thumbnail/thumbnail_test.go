package thumbnail

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"testing"

	"github.com/gen2brain/avif"
)

func TestThumbnailFormats(t *testing.T) {
	for _, format := range []string{"jpeg", "png", "gif"} {
		t.Run(format, func(t *testing.T) {
			source := image.NewRGBA(image.Rect(0, 0, 1600, 900))
			var input, output bytes.Buffer
			var err error
			switch format {
			case "jpeg":
				err = jpeg.Encode(&input, source, nil)
			case "png":
				err = png.Encode(&input, source)
			case "gif":
				err = gif.Encode(&input, source, nil)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := Write(&input, &output); err != nil {
				t.Fatal(err)
			}
			config, err := jpeg.DecodeConfig(bytes.NewReader(output.Bytes()))
			if err != nil {
				t.Fatal(err)
			}
			if config.Width != 112 || config.Height != 63 {
				t.Fatalf("unexpected dimensions: %dx%d", config.Width, config.Height)
			}
			if output.Len() > 5000 {
				t.Fatalf("thumbnail too large: %d bytes", output.Len())
			}
		})
	}
}

func TestSmallTransparentImage(t *testing.T) {
	var input, output bytes.Buffer
	png.Encode(&input, image.NewRGBA(image.Rect(0, 0, 10, 20)))
	if err := Write(&input, &output); err != nil {
		t.Fatal(err)
	}
	result, err := jpeg.Decode(&output)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bounds().Dx() != 10 || result.Bounds().Dy() != 20 {
		t.Fatal("small image was enlarged")
	}
	r, g, b, _ := result.At(0, 0).RGBA()
	if r < 60000 || g < 60000 || b < 60000 {
		t.Fatal("transparent background was not flattened to ivory")
	}
}

func TestInvalidImage(t *testing.T) {
	if err := Write(bytes.NewReader([]byte("invalid")), &bytes.Buffer{}); err == nil {
		t.Fatal("invalid image was accepted")
	}
}

func TestAVIF(t *testing.T) {
	var input, output bytes.Buffer
	if err := avif.Encode(&input, image.NewRGBA(image.Rect(0, 0, 32, 24))); err != nil {
		t.Fatal(err)
	}
	if err := Write(&input, &output); err != nil {
		t.Fatal(err)
	}
	config, err := jpeg.DecodeConfig(&output)
	if err != nil || config.Width != 32 || config.Height != 24 {
		t.Fatalf("AVIF conversion: %+v, %v", config, err)
	}
}

func TestWebP(t *testing.T) {
	input, err := os.Open("testdata/sample.webp")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	var output bytes.Buffer
	if err := Write(input, &output); err != nil {
		t.Fatal(err)
	}
	config, err := jpeg.DecodeConfig(&output)
	if err != nil || config.Width != 112 || config.Height != 84 {
		t.Fatalf("WebP conversion: %+v, %v", config, err)
	}
}

func TestExifOrientation(t *testing.T) {
	data := make([]byte, 32)
	copy(data, []byte("Exif\x00\x00II"))
	binary.LittleEndian.PutUint16(data[8:], 42)
	binary.LittleEndian.PutUint32(data[10:], 8)
	binary.LittleEndian.PutUint16(data[14:], 1)
	binary.LittleEndian.PutUint16(data[16:], 0x0112)
	binary.LittleEndian.PutUint16(data[18:], 3)
	binary.LittleEndian.PutUint32(data[20:], 1)
	binary.LittleEndian.PutUint16(data[24:], 6)
	header := []byte{0xff, 0xd8, 0xff, 0xe1, 0, byte(len(data) + 2)}
	if orientation(append(header, data...)) != 6 {
		t.Fatal("EXIF orientation not read")
	}
	source := image.NewRGBA(image.Rect(0, 0, 2, 3))
	source.SetRGBA(0, 0, color.RGBA{255, 0, 0, 255})
	result := orient(source, 6)
	if result.Bounds().Dx() != 3 || result.Bounds().Dy() != 2 || result.RGBAAt(2, 0).R != 255 {
		t.Fatal("image was not rotated clockwise")
	}
}
