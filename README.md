# 📸 OCR Table-to-WhatsApp (Next.js + Tesseract.js)

A lightweight client-side app to **scan table screenshots** (Excel/Sheets photos) and turn them into a clean, per-sentra list of names — with red cells flagged as **`(tabkur)`** — ready to paste into WhatsApp.

---

## ✨ Features

- 🖱️ **Drag & drop** multiple images at once  
- 🧠 **Client-only OCR** using [`tesseract.js`](https://github.com/naptha/tesseract.js)  
- 🔍 **Smart column detection**  
  - Uses header anchors (`nm_sentra`, `customername`, `ket...`)  
  - Fallback clustering if headers aren’t found  
- 🧹 **Cleaned names**  
  - Removes numbers, product codes, and random tokens  
  - Detects and strips codes even when attached (e.g. `RAHMAWASL9B → Rahmawa`)  
  - Fixes common OCR slips (`11s` → `IIS`)  
  - Proper **Title Case** formatting  
- ❤️ **Detects red “tabkur” rows**  
  - Pixel-based sampling of the `ket` column background  
  - Skips yellow “Best Effort” cells  
- 📋 **One-click copy** of WhatsApp-formatted output  
- 🧾 **Preserves original row order**

---

## 🧰 Tech Stack

| Layer | Technology |
|:------|:------------|
| Framework | [Next.js](https://nextjs.org/) (App Router, Client Component) |
| OCR Engine | [Tesseract.js](https://github.com/naptha/tesseract.js) — English + Indonesian |
| UI | React + TailwindCSS |
| Image Processing | Canvas (grayscale + contrast boost) |

---
