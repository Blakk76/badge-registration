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

function normalizeStatus(rawStatus) {
  const upper = (rawStatus || "").toUpperCase();

  const STATUS_MAP = {
    "CONGRESS PARTICIPANT": "CONGRESS",
  };

  return STATUS_MAP[upper] || upper;
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

  const [bgBytes, topBytes, bookFontBytes, boldFontBytes] = await Promise.all([
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

async function drawBadge(pdfDoc, supabase, user, page, originX = 0, originY = 0) {
  const rawStatus = (user.status || "").toUpperCase();
  const status = normalizeStatus(rawStatus);
  const fullName = (user.full_name || "").toUpperCase();
  const country = (user.country || "").toUpperCase();

  const { bgEmbeddedPage, topEmbeddedPage, futuraBook, futuraBold } =
    await loadBadgeAssets(pdfDoc, rawStatus);

  const badgeWidth = bgEmbeddedPage.width;
  const badgeHeight = bgEmbeddedPage.height;
  const beige = hexToRgb("#c2b59b");

  page.drawPage(bgEmbeddedPage, {
    x: originX,
    y: originY,
    width: badgeWidth,
    height: badgeHeight,
  });

  // Photo
  const photoX = originX + 18;
  const photoY = originY + 118;
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

  page.drawPage(topEmbeddedPage, {
    x: originX,
    y: originY,
    width: badgeWidth,
    height: badgeHeight,
  });

  // Text
  const baseNameSize = 26;
  const baseCountrySize = 20;
  const baseStatusSize = 45;

  const nameMaxWidth = 150;
  const countryMaxWidth = 90;
  const statusMaxHeight = 130;

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

  const statusSize = fitFontSize(
    status,
    futuraBold,
    baseStatusSize,
    statusMaxHeight,
    24
  );

  page.drawText(fullName, {
    x: originX + 75,
    y: originY + 98,
    size: nameSize,
    font: futuraBook,
    color: beige,
  });

  page.drawText(country, {
    x: originX + 75,
    y: originY + 80,
    size: countrySize,
    font: futuraBook,
    color: beige,
  });

  drawTrackedText(page, status, {
    x: originX + 210,
    y: originY + 300,
    size: statusSize,
    font: futuraBold,
    color: beige,
    rotate: degrees(-90),
    tracking: 200,
    direction: "vertical",
  });

  return { badgeWidth, badgeHeight };
}

export async function GET(_request, { params }) {
  try {
    const id = params.id;

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
      return new Response(`Supabase query error: ${error.message}`, { status: 500 });
    }

    if (!user) {
      return new Response("Person not found", { status: 404 });
    }

    const pdfDoc = await PDFDocument.create();

    const { bgEmbeddedPage } = await loadBadgeAssets(
      pdfDoc,
      (user.status || "").toUpperCase()
    );

    const page = pdfDoc.addPage([bgEmbeddedPage.width, bgEmbeddedPage.height]);

    await drawBadge(pdfDoc, supabase, user, page, 0, 0);

    const pdfBytes = await pdfDoc.save();

    const safeName = (user.full_name || "badge").replace(/[^\w\-]+/g, "_");

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}.pdf"`,
      },
    });
  } catch (e) {
    return new Response(`Route error: ${e.message}`, { status: 500 });
  }
}