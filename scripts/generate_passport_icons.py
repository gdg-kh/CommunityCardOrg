import os
from PIL import Image, ImageDraw, ImageFont

def create_passport_icon(size, is_maskable=False):
    # Base canvas
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    bg_color = (20, 33, 46, 255)  # #14212e
    gold = (234, 179, 8, 255)     # #eab308
    gold_soft = (250, 204, 21, 255)
    cream = (248, 249, 250, 255)
    cyan = (56, 189, 248, 255)

    if is_maskable:
        # Full bleed background for maskable icons
        draw.rectangle([0, 0, size, size], fill=bg_color)
        padding = size * 0.15
    else:
        # Rounded rectangle for normal icons
        corner_radius = size * 0.22
        draw.rounded_rectangle([0, 0, size, size], radius=int(corner_radius), fill=bg_color)
        padding = size * 0.08

    # Inner passport frame
    card_left = padding
    card_top = padding
    card_right = size - padding
    card_bottom = size - padding

    # Gold decorative border
    border_width = max(2, int(size * 0.015))
    draw.rounded_rectangle(
        [card_left, card_top, card_right, card_bottom],
        radius=int(size * 0.08),
        outline=gold,
        width=border_width
    )

    # Load fonts
    font_large = None
    font_small = None
    font_bold = None
    font_paths = [
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc"
    ]
    
    large_size = int(size * 0.11)
    small_size = int(size * 0.085)
    year_size = int(size * 0.14)

    for p in font_paths:
        if os.path.exists(p):
            try:
                font_year = ImageFont.truetype(p, year_size)
                font_title = ImageFont.truetype(p, large_size)
                font_sub = ImageFont.truetype(p, small_size)
                break
            except Exception:
                continue
    else:
        font_year = ImageFont.load_default()
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    # Draw Year "2027"
    year_text = "2027"
    bbox_year = draw.textbbox((0, 0), year_text, font=font_year)
    yw = bbox_year[2] - bbox_year[0]
    year_y = card_top + (card_bottom - card_top) * 0.08
    draw.text(((size - yw) / 2, year_y), year_text, fill=gold_soft, font=font_year)

    # Draw Central Stamp Badge
    center_x = size / 2
    center_y = size * 0.49
    outer_r = size * 0.18
    inner_r = size * 0.15

    # Seal outer circle
    draw.ellipse(
        [center_x - outer_r, center_y - outer_r, center_x + outer_r, center_y + outer_r],
        outline=gold,
        width=max(2, int(size * 0.012))
    )

    # Seal inner dashed-like / secondary circle
    draw.ellipse(
        [center_x - inner_r, center_y - inner_r, center_x + inner_r, center_y + inner_r],
        outline=(56, 189, 248, 180),
        width=max(1, int(size * 0.008))
    )

    # Four-point star / compass in seal center
    star_r = size * 0.09
    star_points = [
        (center_x, center_y - star_r),                  # Top
        (center_x + star_r * 0.28, center_y - star_r * 0.28),
        (center_x + star_r, center_y),                  # Right
        (center_x + star_r * 0.28, center_y + star_r * 0.28),
        (center_x, center_y + star_r),                  # Bottom
        (center_x - star_r * 0.28, center_y + star_r * 0.28),
        (center_x - star_r, center_y),                  # Left
        (center_x - star_r * 0.28, center_y - star_r * 0.28),
    ]
    draw.polygon(star_points, fill=gold)

    # Tiny center dot
    dot_r = max(2, int(size * 0.02))
    draw.ellipse([center_x - dot_r, center_y - dot_r, center_x + dot_r, center_y + dot_r], fill=bg_color)

    # Draw "社群護照"
    title_text = "社群護照"
    bbox_title = draw.textbbox((0, 0), title_text, font=font_title)
    tw = bbox_title[2] - bbox_title[0]
    title_y = card_bottom - (card_bottom - card_top) * 0.27
    draw.text(((size - tw) / 2, title_y), title_text, fill=cream, font=font_title)

    # Draw "COMMUNITY PASSPORT"
    sub_text = "PASSPORT"
    bbox_sub = draw.textbbox((0, 0), sub_text, font=font_sub)
    sw = bbox_sub[2] - bbox_sub[0]
    sub_y = card_bottom - (card_bottom - card_top) * 0.13
    draw.text(((size - sw) / 2, sub_y), sub_text, fill=cyan, font=font_sub)

    return img

def main():
    target_dir = "assets/passport"
    os.makedirs(target_dir, exist_ok=True)

    # Generate icons
    icon_192 = create_passport_icon(192, is_maskable=False)
    icon_192.save(os.path.join(target_dir, "icon-192.png"), "PNG")

    icon_512 = create_passport_icon(512, is_maskable=False)
    icon_512.save(os.path.join(target_dir, "icon-512.png"), "PNG")

    icon_maskable = create_passport_icon(512, is_maskable=True)
    icon_maskable.save(os.path.join(target_dir, "icon-maskable-512.png"), "PNG")

    # iOS applies its own rounded squircle mask; transparent corners would render as black
    apple_icon = create_passport_icon(180, is_maskable=True)
    apple_icon.save(os.path.join(target_dir, "apple-touch-icon.png"), "PNG")

    print("Passport icons successfully generated in", target_dir)

if __name__ == "__main__":
    main()
