package thumbnail

import (
	"bytes"
	"encoding/binary"
	"image"
)

// Read only JPEG's TIFF orientation field. The thumbnail encoder drops all EXIF.
func orientation(data []byte) uint16 {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return 1
	}
	for offset := 2; offset+4 <= len(data); {
		if data[offset] != 0xff {
			return 1
		}
		marker := data[offset+1]
		if marker == 0xda || marker == 0xd9 {
			return 1
		}
		size := int(binary.BigEndian.Uint16(data[offset+2 : offset+4]))
		if size < 2 || offset+2+size > len(data) {
			return 1
		}
		segment := data[offset+4 : offset+2+size]
		offset += 2 + size
		if marker != 0xe1 || !bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			continue
		}
		tiff := segment[6:]
		if len(tiff) < 8 {
			return 1
		}
		var order binary.ByteOrder
		if string(tiff[:2]) == "II" {
			order = binary.LittleEndian
		} else if string(tiff[:2]) == "MM" {
			order = binary.BigEndian
		} else {
			return 1
		}
		if order.Uint16(tiff[2:4]) != 42 {
			return 1
		}
		start := uint64(order.Uint32(tiff[4:8]))
		if start+2 > uint64(len(tiff)) {
			return 1
		}
		count := uint64(order.Uint16(tiff[start : start+2]))
		for i := uint64(0); i < count; i++ {
			entry := start + 2 + i*12
			if entry+12 > uint64(len(tiff)) {
				return 1
			}
			if order.Uint16(tiff[entry:entry+2]) == 0x0112 && order.Uint16(tiff[entry+2:entry+4]) == 3 && order.Uint32(tiff[entry+4:entry+8]) == 1 {
				value := order.Uint16(tiff[entry+8 : entry+10])
				if value >= 1 && value <= 8 {
					return value
				}
			}
		}
	}
	return 1
}

func orient(source *image.RGBA, value uint16) *image.RGBA {
	if value <= 1 || value > 8 {
		return source
	}
	w, h := source.Bounds().Dx(), source.Bounds().Dy()
	wOut, hOut := w, h
	if value >= 5 {
		wOut, hOut = h, w
	}
	result := image.NewRGBA(image.Rect(0, 0, wOut, hOut))
	for y := 0; y < hOut; y++ {
		for x := 0; x < wOut; x++ {
			sx, sy := x, y
			switch value {
			case 2:
				sx = w - 1 - x
			case 3:
				sx, sy = w-1-x, h-1-y
			case 4:
				sy = h - 1 - y
			case 5:
				sx, sy = y, x
			case 6:
				sx, sy = y, h-1-x
			case 7:
				sx, sy = w-1-y, h-1-x
			case 8:
				sx, sy = w-1-y, x
			}
			result.SetRGBA(x, y, source.RGBAAt(sx, sy))
		}
	}
	return result
}
