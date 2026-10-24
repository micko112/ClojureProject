import io
import unittest

import numpy as np
from PIL import Image

from app import preprocess as pp


def jpeg_bytes(im):
    b = io.BytesIO()
    im.save(b, "JPEG", quality=95)
    return b.getvalue()


class ResizeTest(unittest.TestCase):
    def test_shortest_edge_becomes_224_and_aspect_is_kept(self):
        self.assertEqual(pp.resize_shortest_edge(Image.new("RGB", (640, 480))).size, (298, 224))
        self.assertEqual(pp.resize_shortest_edge(Image.new("RGB", (480, 640))).size, (224, 298))
        self.assertEqual(pp.resize_shortest_edge(Image.new("RGB", (224, 224))).size, (224, 224))

    def test_long_side_is_truncated_like_transformers(self):
        # 224 * 1000 / 225 = 995.55 -> 995 (int(), not round())
        self.assertEqual(pp.resize_shortest_edge(Image.new("RGB", (1000, 225))).size, (995, 224))

    def test_small_images_are_upscaled(self):
        self.assertEqual(pp.resize_shortest_edge(Image.new("RGB", (50, 100))).size, (224, 448))


class CropTest(unittest.TestCase):
    def test_center_crop_takes_the_middle(self):
        arr = np.zeros((224, 300, 3), dtype=np.float32)
        arr[:, 38:262] = 1.0  # the central 224 columns ((300 - 224) // 2 = 38)
        out = pp.center_crop(arr)
        self.assertEqual(out.shape, (224, 224, 3))
        self.assertTrue(np.all(out == 1.0))


class PreprocessTest(unittest.TestCase):
    def test_shape_dtype_and_normalisation(self):
        x = pp.preprocess(Image.new("RGB", (500, 300), (255, 0, 128)))
        self.assertEqual(x.shape, (1, 3, 224, 224))
        self.assertEqual(x.dtype, np.float32)
        expected = (np.array([255, 0, 128]) / 255.0 - pp.MEAN) / pp.STD
        np.testing.assert_allclose(x[0, :, 100, 100], expected, rtol=1e-5)

    def test_mean_colour_maps_to_zero(self):
        mean_rgb = tuple(int(round(v * 255)) for v in pp.MEAN)
        x = pp.preprocess(Image.new("RGB", (224, 224), mean_rgb))
        self.assertLess(float(np.abs(x).max()), 0.01)

    def test_grayscale_and_rgba_become_three_channels(self):
        for mode in ("L", "RGBA", "P"):
            self.assertEqual(pp.preprocess(Image.new(mode, (300, 300))).shape, (1, 3, 224, 224))

    def test_exif_orientation_is_applied(self):
        # 400x200 landscape stored with orientation 6 (rotate 90 cw) => portrait.
        im = Image.new("RGB", (400, 200), (0, 0, 0))
        im.paste((255, 255, 255), (0, 0, 200, 200))  # left half white
        exif = Image.Exif()
        exif[0x0112] = 6
        b = io.BytesIO()
        im.save(b, "JPEG", exif=exif, quality=95)
        loaded = pp.load_image(b.getvalue())
        x = pp.preprocess(loaded)
        # After rotating clockwise the white half is on top.
        top = float(x[0, 0, 10, 112])
        bottom = float(x[0, 0, 210, 112])
        self.assertGreater(top, bottom)

    def test_bytes_round_trip(self):
        x = pp.preprocess_bytes(jpeg_bytes(Image.new("RGB", (320, 240), (10, 200, 30))))
        self.assertEqual(x.shape, (1, 3, 224, 224))

    def test_garbage_bytes_raise(self):
        with self.assertRaises(Exception):
            pp.preprocess_bytes(b"<html>not an image</html>")


if __name__ == "__main__":
    unittest.main()
