"""Generate DeepWork app icon as PNG and ICO using Pillow."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math
import os

SIZE = 512
OUT_DIR = os.path.join(os.path.dirname(__file__), "resources")


def lerp_color(c1, c2, t):
    """Linear interpolation between two RGB colors."""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def draw_icon(size=SIZE):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # --- Rounded rectangle background ---
    corner_r = size * 96 // 512
    # Deep navy-to-purple gradient via vertical bands
    for y in range(size):
        t = y / size
        if t < 0.5:
            color = lerp_color((15, 22, 41), (26, 26, 62), t * 2)
        else:
            color = lerp_color((26, 26, 62), (30, 17, 69), (t - 0.5) * 2)
        draw.line([(0, y), (size - 1, y)], fill=color + (255,))

    # Apply rounded corners via mask
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner_r, fill=255)
    img.putalpha(mask)

    draw = ImageDraw.Draw(img)

    # --- Subtle grid lines (dashboard feel) ---
    grid_color = (59, 130, 246, 18)  # very faint blue
    for gy in [150, 256, 362]:
        y = int(gy * size / 512)
        draw.line([(size * 80 // 512, y), (size * 432 // 512, y)], fill=grid_color, width=1)
    for gx in [160, 256, 352]:
        x = int(gx * size / 512)
        draw.line([(x, size * 100 // 512), (x, size * 412 // 512)], fill=grid_color, width=1)

    # --- Outer focus ring ---
    cx, cy = size // 2, size // 2
    for r, alpha, w in [(140, 50, 4), (110, 80, 3)]:
        radius = int(r * size / 512)
        width = int(w * size / 512)
        ring_color = (96, 165, 250, alpha) if r == 140 else (59, 130, 246, alpha + 40)
        bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
        draw.ellipse(bbox, outline=ring_color, width=width)

    # --- Stylized "D" letterform ---
    s = size / 512  # scale factor

    # D path: left vertical + right curve
    d_width = int(20 * s)

    # Vertical bar of D
    x_left = int(185 * s)
    y_top = int(155 * s)
    y_bot = int(357 * s)
    d_color = (59, 130, 246, 255)  # blue
    draw.line([(x_left, y_top), (x_left, y_bot)], fill=d_color, width=d_width)

    # Top horizontal
    draw.line([(x_left, y_top), (int(255 * s), y_top)], fill=d_color, width=d_width)
    # Bottom horizontal
    draw.line([(x_left, y_bot), (int(255 * s), y_bot)], fill=d_color, width=d_width)

    # Right curve of D (arc)
    arc_left = int(210 * s)
    arc_top = int(155 * s)
    arc_right = int(380 * s)
    arc_bottom = int(357 * s)
    draw.arc([arc_left, arc_top, arc_right, arc_bottom], start=-90, end=90,
             fill=d_color, width=d_width)

    # --- Inner "W" accent (work/waves) ---
    w_color = (147, 130, 250, 230)  # purple-blue glow
    w_width = int(6 * s)
    w_points = [
        (220, 232), (238, 278), (256, 238), (274, 278), (292, 232)
    ]
    w_scaled = [(int(x * s), int(y * s)) for x, y in w_points]
    for i in range(len(w_scaled) - 1):
        draw.line([w_scaled[i], w_scaled[i + 1]], fill=w_color, width=w_width)

    # --- Activity pulse dot (top-right) ---
    dot_cx, dot_cy = int(398 * s), int(122 * s)
    # Outer glow
    draw.ellipse([dot_cx - int(18 * s), dot_cy - int(18 * s),
                  dot_cx + int(18 * s), dot_cy + int(18 * s)],
                 fill=(59, 130, 246, 180))
    # Mid ring
    draw.ellipse([dot_cx - int(11 * s), dot_cy - int(11 * s),
                  dot_cx + int(11 * s), dot_cy + int(11 * s)],
                 fill=(96, 165, 250, 255))
    # Center white dot
    draw.ellipse([dot_cx - int(5 * s), dot_cy - int(5 * s),
                  dot_cx + int(5 * s), dot_cy + int(5 * s)],
                 fill=(255, 255, 255, 230))

    # --- Subtle border on rounded rect ---
    border_color = (37, 99, 235, 50)
    draw_on_alpha = ImageDraw.Draw(img)
    draw_on_alpha.rounded_rectangle([int(16 * s), int(16 * s), size - int(16 * s), size - int(16 * s)],
                                     radius=int(90 * s), outline=border_color, width=int(2 * s))

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Generating 512x512 icon...")
    icon = draw_icon(512)

    # Save high-res PNG
    png_path = os.path.join(OUT_DIR, "icon.png")
    icon.save(png_path, "PNG")
    print(f"  -> {png_path} ({os.path.getsize(png_path):,} bytes)")

    # Generate ICO with multiple sizes
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = []
    for s in ico_sizes:
        resized = icon.resize((s, s), Image.LANCZOS)
        ico_images.append(resized)

    # Save ICO (first image is default, rest are alternates)
    ico_images[0].save(ico_path, format="ICO", append_images=ico_images[1:],
                       sizes=[(s, s) for s in ico_sizes])
    print(f"  -> {ico_path} ({os.path.getsize(ico_path):,} bytes)")

    # Also save a 256x256 for electron-builder
    icon_256 = icon.resize((256, 256), Image.LANCZOS)
    png256_path = os.path.join(OUT_DIR, "icon-256.png")
    icon_256.save(png256_path, "PNG")
    print(f"  -> {png256_path} ({os.path.getsize(png256_path):,} bytes)")

    print("Done!")


if __name__ == "__main__":
    main()
