from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs('icons', exist_ok=True)

for size in [192, 512]:
    img = Image.new('RGB', (size, size), '#0a0a0f')
    draw = ImageDraw.Draw(img)

    # Purple circle background
    margin = size // 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill='#A855F7')

    # "TB" text
    font_size = size // 3
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except OSError:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", font_size)
        except OSError:
            font = ImageFont.load_default()

    text = "TB"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((size - tw) // 2, (size - th) // 2 - size // 12), text, fill='white', font=font)

    img.save(f'icons/icon-{size}.png')
    print(f'Created icon-{size}.png')
