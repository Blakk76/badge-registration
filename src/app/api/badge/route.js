import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return rgb(
    ((bigint >> 16) & 255) / 255,
    ((bigint >> 8) & 255) / 255,
    (bigint & 255) / 255
  );
}

async function makeOvalPng(inputBuffer, width, height) {
  const fitted = await sharp(inputBuffer)
    .resize(width, height, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();

  const svgMask = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="black"/>
      <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="white"/>
    </svg>
  `;

  return await sharp(fitted)
    .composite([{ input: Buffer.from(svgMask), blend: "dest-in" }])
    .png()
    .toBuffer();
}

// Safe font shrink
function fitFontSize(text, font, startSize, maxWidth, minSize = 8) {
  let size = startSize;

  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }

  return size;
}

// Proper vertical tracking (FIXED)
function drawTrackedText(page, text, options) {
  const {
    x,
    y,
    font,
    size,
    color,
    rotate = degrees(0),
    tracking = 0,
    direction = "horizontal",
  } = options;

  const trackingPoints = (tracking / 1000) * size;

  let cursorX = x;
  let cursorY = y;

  for (const char of text) {
    page.drawText(char, {
      x: cursorX,
      y: cursorY,
      size,
      font,
      color,
      rotate,
    });

    const charWidth = font.widthOfTextAtSize(char, size);

    if (direction === "vertical") {
      cursorY -= charWidth + trackingPoints;
    } else {
      cursorX += charWidth + trackingPoints;
    }
  }
}

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      return new Response(`Supabase query error: ${error.message}`, {
        status: 500,
      });
    }

    const user = data?.[0];
    if (!user) {
      return new Response("No users found", { status: 400 });
    }

    let status = (user.status || "").toUpperCase();

// normalize long statuses
if (status === "CONGRESS PARTICIPANT") {
  status = "CONGRESS";
}

    // ✅ VIP / VVIP switching
    let bgFile = "badge_bg_clean.pdf";
    let topFile = "badge_top.pdf";

    if (status === "VIP") {
      bgFile = "badge_bg_vip.pdf";
      topFile = "badge_top_vip.pdf";
    } else if (status === "VVIP") {
      bgFile = "badge_bg_vvip.pdf";
      topFile = "badge_top_vvip.pdf";
    }

    const bgPath = path.join(process.cwd(), "public", bgFile);
    const topPath = path.join(process.cwd(), "public", topFile);

    const bookFontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      "FuturaPTCond-Book.ttf"
    );

    const boldFontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      "FuturaPT-Bold.ttf"
    );

    const [bgBytes, topBytes, bookFontBytes, boldFontBytes] =
      await Promise.all([
        fs.readFile(bgPath),
        fs.readFile(topPath),
        fs.readFile(bookFontPath),
        fs.readFile(boldFontPath),
      ]);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const [bgEmbeddedPage] = await pdfDoc.embedPdf(bgBytes, [0]);
    const [topEmbeddedPage] = await pdfDoc.embedPdf(topBytes, [0]);

    const futuraBook = await pdfDoc.embedFont(bookFontBytes);
    const futuraBold = await pdfDoc.embedFont(boldFontBytes);

    const width = bgEmbeddedPage.width;
    const height = bgEmbeddedPage.height;

    const page = pdfDoc.addPage([width, height]);
    const beige = hexToRgb("#c2b59b");

    // Background
    page.drawPage(bgEmbeddedPage, {
      x: 0,
      y: 0,
      width,
      height,
    });

    // Photo
    const photoX = 18;
    const photoY = 118;
    const photoW = 170;
    const photoH = 170;

    if (user.photo_path) {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(user.photo_path, 60);

      const photoRes = await fetch(signed.signedUrl);
      const rawPhoto = Buffer.from(await photoRes.arrayBuffer());

      const ovalPng = await makeOvalPng(
        rawPhoto,
        Math.round(photoW * 3),
        Math.round(photoH * 3)
      );

      const embeddedPhoto = await pdfDoc.embedPng(ovalPng);

      page.drawImage(embeddedPhoto, {
        x: photoX,
        y: photoY,
        width: photoW,
        height: photoH,
      });
    }

    // Overlay
    page.drawPage(topEmbeddedPage, {
      x: 0,
      y: 0,
      width,
      height,
    });

    // TEXT
    const fullName = (user.full_name || "").toUpperCase();
    const country = (user.country || "").toUpperCase();

    const baseNameSize = 26;
    const baseCountrySize = 20;
    const statusSize = 45;

    const nameMaxWidth = 150;
    const countryMaxWidth = 90;

    const nameSize = fitFontSize(
      fullName,
      futuraBook,
      baseNameSize,
      nameMaxWidth,
      14
    );

    const countrySize = fitFontSize(
      country,
      futuraBook,
      baseCountrySize,
      countryMaxWidth,
      12
    );

    // Name
    page.drawText(fullName, {
      x: 75,
      y: 98,
      size: nameSize,
      font: futuraBook,
      color: beige,
    });

    // Country
    page.drawText(country, {
      x: 75,
      y: 80,
      size: countrySize,
      font: futuraBook,
      color: beige,
    });

    // Status (vertical, tracking fixed)
    drawTrackedText(page, status, {
      x: 210,
      y: 300,
      size: statusSize,
      font: futuraBold,
      color: beige,
      rotate: degrees(-90),
      tracking: 200,
      direction: "vertical",
    });

    const pdfBytes = await pdfDoc.save();

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="badge.pdf"',
      },
    });
  } catch (e) {
    return new Response(`Route error: ${e.message}`, { status: 500 });
  }
}