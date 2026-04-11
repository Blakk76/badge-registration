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

function fitFontSize(text, font, startSize, maxWidth, minSize = 8) {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

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

function normalizeStatusLines(rawStatus) {
  const upper = (rawStatus || "").toUpperCase();

  if (upper === "CONGRESS PARTICIPANT") {
    return ["CONGRESS", "PARTICIPANT"];
  }

  if (upper === "CONGRESS ONLY") {
    return ["CONGRESS", "ONLY"];
  }

  if (upper === "EWF EB MEMBER") {
    return ["EWF"];
  }

  return [upper];
}

async function loadBadgeAssets(pdfDoc, rawStatus) {
  const upper = (rawStatus || "").toUpperCase();

  let bgFile = "badge_bg_clean.pdf";
  let topFile = "badge_top.pdf";

  // VIP-style template for VIP / VVIP / LOC
  if (upper === "VIP" || upper === "VVIP" || upper === "LOC") {
    bgFile = "badge_bg_vip.pdf";
    topFile = "badge_top_vip.pdf";
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

  pdfDoc.registerFontkit(fontkit);

  const [bgEmbeddedPage] = await pdfDoc.embedPdf(bgBytes, [0]);
  const [topEmbeddedPage] = await pdfDoc.embedPdf(topBytes, [0]);

  const futuraBook = await pdfDoc.embedFont(bookFontBytes);
  const futuraBold = await pdfDoc.embedFont(boldFontBytes);

  return { bgEmbeddedPage, topEmbeddedPage, futuraBook, futuraBold };
}

async function drawBadge(pdfDoc, supabase, user, page) {
  const rawStatus = (user.status || "").toUpperCase();
  const statusLines = normalizeStatusLines(rawStatus);

  const fullName = (user.full_name || "").toUpperCase();
  const country = (user.country || "").toUpperCase();

  const { bgEmbeddedPage, topEmbeddedPage, futuraBook, futuraBold } =
    await loadBadgeAssets(pdfDoc, rawStatus);

  const width = bgEmbeddedPage.width;
  const height = bgEmbeddedPage.height;
  const beige = hexToRgb("#c2b59b");

  page.setSize(width, height);

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
    const { data: signed, error: signedError } = await supabase.storage
      .from("photos")
      .createSignedUrl(user.photo_path, 60);

    if (signedError) {
      throw new Error(`Signed URL error: ${signedError.message}`);
    }

    const photoRes = await fetch(signed.signedUrl);
    if (!photoRes.ok) {
      throw new Error(`Could not fetch photo: ${photoRes.status}`);
    }

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

  // Top overlay
  page.drawPage(topEmbeddedPage, {
    x: 0,
    y: 0,
    width,
    height,
  });

  // Dynamic text
  const baseNameSize = 26;
  const baseCountrySize = 20;

  const nameSize = fitFontSize(fullName, futuraBook, baseNameSize, 150, 14);
  const countrySize = fitFontSize(country, futuraBook, baseCountrySize, 90, 12);

  page.drawText(fullName, {
    x: 75,
    y: 98,
    size: nameSize,
    font: futuraBook,
    color: beige,
  });

  page.drawText(country, {
    x: 75,
    y: 80,
    size: countrySize,
    font: futuraBook,
    color: beige,
  });

  // Status: one or two lines, vertical
const tracking = 80;
const isCongressStyle =
  rawStatus === "CONGRESS PARTICIPANT" ||
  rawStatus === "CONGRESS ONLY";
const statusSize = isCongressStyle ? 22 : 45;

// for rotated text, line separation must happen on X
const lineGapX = 24;

// anchor for first line
const statusX = 220;
const statusY = 300;

statusLines.forEach((line, index) => {
  drawTrackedText(page, line, {
    x: statusX - index * lineGapX,
    y: statusY,
    size: statusSize,
    font: futuraBold,
    color: beige,
    rotate: degrees(-90),
    tracking,
    direction: "vertical",
  });
});
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1];

    if (!id || id === "badge") {
      return new Response("Missing badge id", { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: user, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return new Response(`Supabase query error: ${error.message}`, {
        status: 500,
      });
    }

    if (!user) {
      return new Response("Person not found", { status: 404 });
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([1, 1]);

    await drawBadge(pdfDoc, supabase, user, page);

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