"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createWorker, PSM, OEM } from "tesseract.js";


type Row = { nm_sentra: string; customername: string; tabkur: boolean };
type OCRWord = { text: string; x0: number; y0: number; x1: number; y1: number; conf: number };


let _worker: any | null = null;
async function getWorker(langCombo = "eng+ind") {
    if (_worker) return _worker;
    _worker = await (createWorker as any)(["eng", "ind"]);
    try {
        if (_worker.reinitialize) await _worker.reinitialize(langCombo, OEM.LSTM_ONLY as any);
        else if (_worker.loadLanguage) await _worker.loadLanguage(langCombo);
    } catch { }
    try {
        await _worker.setParameters?.({
            preserve_interword_spaces: "1",
            classify_bln_numeric_mode: "1",
            tessedit_pageseg_mode: String(PSM.SPARSE_TEXT),
        } as any);
    } catch { }
    return _worker;
}


const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* --- KODE PRODUK ---
   cover:
   - Huruf saja: PMDA, SLGB, TPDA
   - Huruf+angka: PM31, SL9B, PM21, P101
   - Angka+huruf: 6C, 41B, 212A
*/
const PROD_PAT =
    /^(?:PM|SL|TP|PL|RM|KM|P)[A-Z0-9]{1,4}$|^\d{1,4}[A-Z]{1,3}$/i;
const isProdCode = (t: string) => PROD_PAT.test(t);


function stripProdSuffix(name: string) {

    return name
        .replace(
            /(?:\s|-|_)?((?:PM|SL|TP|PL|RM|KM|P)[A-Z0-9]{1,4}|\d{1,4}[A-Z]{1,3})$/i,
            ""
        )
        .trim();
}

const isDateLike = (t: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(t);
const isNumericLike = (t: string) => /^[-+]?\d{1,3}([.,]\d{3})*([.,]\d+)?$/.test(t);
const isHeaderWord = (t: string) =>
    /^(nm|nm_sentra|sentra|customer|customername|name|kd|produk|plafon|angsuran|angs|saldo|saldotabung|tabungan|kettabungan|ket|current|month|level|an|header|kolom|sisa|best|effort|nama|co)$/i.test(
        t.replace(/[|_]/g, "")
    );

const toTitle = (s: string) =>
    s
        .toLowerCase()
        .replace(/\b([a-zà-öø-ÿ])([a-zà-öø-ÿ']*)/gi, (_, a: string, b: string) => a.toUpperCase() + b);


function fixName(s: string) {
    let t = s.trim();
    t = t.replace(/[\]\.,;:_]+$/g, "");
    t = t.replace(/\b(?:11s|1is|i1s)\b/gi, "IIS");
    t = stripProdSuffix(t);
    if (/^[\p{L}\s'’-]+$/u.test(t)) t = toTitle(t);
    return t;
}


function cleanCustomerName(s: string) {
    const toks = s
        .replace(/[|]/g, " ")
        .split(/\s+/)
        .map((t) => t.normalize("NFKC"))
        .filter(Boolean);

    const kept: string[] = [];
    for (const raw of toks) {
        const bare = raw.replace(/[^\p{L}\p{N}]/gu, "");
        if (!bare) continue;
        if (isHeaderWord(bare)) break;
        if (isProdCode(bare)) break;
        if (isDateLike(bare)) break;
        if (isNumericLike(bare)) break;
        if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(bare)) break;
        kept.push(raw);
    }
    if (kept.length === 1 && kept[0].toLowerCase() === "bu") return "";
    return fixName(kept.join(" "));
}

function cleanSentraName(s: string) {
    return s.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
}

function cluster1D(values: number[], tol = 80) {
    if (!values.length) return [] as number[];
    const xs = [...values].sort((a, b) => a - b);
    const centers: number[] = [];
    let bucket: number[] = [xs[0]];
    for (let i = 1; i < xs.length; i++) {
        if (Math.abs(xs[i] - bucket[bucket.length - 1]) <= tol) bucket.push(xs[i]);
        else {
            centers.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
            bucket = [xs[i]];
        }
    }
    centers.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
    return centers;
}


function drawRotated(source: HTMLCanvasElement | HTMLImageElement, angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const W = (source as HTMLCanvasElement).width ?? (source as HTMLImageElement).width;
    const H = (source as HTMLCanvasElement).height ?? (source as HTMLImageElement).height;
    const out = document.createElement("canvas");
    out.width = Math.round(W * cos + H * sin);
    out.height = Math.round(W * sin + H * cos);
    const ctx = out.getContext("2d")!;
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(source as any, -W / 2, -H / 2);
    return out;
}

function buildCanvases(img: HTMLImageElement, upscale = 1) {
    const maxW = 2400 * upscale;
    const baseScale = img.width > maxW ? maxW / img.width : upscale;
    const W = Math.round(img.width * baseScale);
    const H = Math.round(img.height * baseScale);

    const color = document.createElement("canvas");
    color.width = W;
    color.height = H;
    const cctx = color.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(img, 0, 0, W, H);

    const gray = document.createElement("canvas");
    gray.width = W;
    gray.height = H;
    const gctx = gray.getContext("2d")!;
    gctx.drawImage(color, 0, 0);
    const imgData = gctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    const contrast = 1.16;
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
            g = d[i + 1],
            b = d[i + 2];
        const grayVal = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        const c = clamp((grayVal - 128) * contrast + 128, 0, 255);
        d[i] = d[i + 1] = d[i + 2] = c;
    }
    gctx.putImageData(imgData, 0, 0);

    return { color, cctx, gray, gctx };
}


function parseTSV(tsv: string): OCRWord[] {
    const lines = tsv.split(/\r?\n/);
    const out: OCRWord[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        if (Number(cols[0]) !== 5) continue;
        const left = Number(cols[6]),
            top = Number(cols[7]),
            width = Number(cols[8]),
            height = Number(cols[9]);
        const conf = Number(cols[10]);
        const text = cols.slice(11).join("\t").trim();
        if (!text || !/[A-Za-z0-9]/.test(text)) continue;
        out.push({ text, x0: left, y0: top, x1: left + width, y1: top + height, conf });
    }
    return out;
}


type Bands = { nm: { L: number; R: number }; cust: { L: number; R: number }; ket: { L: number; R: number } };

function detectBandsByHeader(words: OCRWord[], canvasW: number): Bands | null {
    const minY = Math.min(...words.map((w) => w.y0));
    const maxY = Math.max(...words.map((w) => w.y1));
    const headerY = minY + (maxY - minY) * 0.25;
    const headerWords = words.filter((w) => (w.y0 + w.y1) / 2 <= headerY);

    const nmCenters = headerWords
        .filter((w) => /^nm[_\s-]*sentra$/i.test(w.text.replace(/[|]/g, "").toLowerCase()))
        .map((w) => (w.x0 + w.x1) / 2);
    const custCenters = headerWords
        .filter((w) => /^customer(name)?$/i.test(w.text.replace(/[|]/g, "").toLowerCase()))
        .map((w) => (w.x0 + w.x1) / 2);
    const ketCenters = headerWords
        .filter((w) => /(ket|kettabungan|saldo.*tab|current.*month)/i.test(w.text.replace(/[|]/g, "")))
        .map((w) => (w.x0 + w.x1) / 2);

    if (!custCenters.length || (!ketCenters.length && !nmCenters.length)) return null;

    const nmX = nmCenters.length ? Math.round(nmCenters[0]) : Math.round(canvasW * 0.07);
    const custX = Math.round(custCenters[0]);
    const ketX = ketCenters.length ? Math.round(ketCenters[ketCenters.length - 1]) : Math.round(canvasW * 0.75);

    const nmR = Math.round((nmX + custX) / 2);
    const custR = Math.round((custX + ketX) / 2);
    const nmL = Math.max(0, nmX - (nmR - nmX));
    const custL = Math.round((nmX + custX) / 2);
    const ketL = Math.round((custX + ketX) / 2);
    const ketR = Math.min(canvasW, ketX + (ketX - ketL));

    return {
        nm: { L: nmL, R: nmR },
        cust: { L: custL + 6, R: custR - 6 },
        ket: { L: ketL + 6, R: ketR - 6 },
    };
}


function detectBandsFallback(words: OCRWord[], canvasW: number): Bands {
    const xs = words.map((w) => w.x0);
    let centers = cluster1D(xs, 60).sort((a, b) => a - b);
    if (centers.length >= 3) centers = [centers[0], centers[Math.round(centers.length / 2)], centers[centers.length - 1]];
    else if (centers.length === 2) {
        const [l, r] = centers;
        centers = [l, Math.round((l + r) / 2), r];
    } else if (centers.length === 1) {
        const c = centers[0];
        centers = [Math.round(c * 0.6), c, Math.round(c + (canvasW - c) * 0.5)];
    } else {
        centers = [Math.round(canvasW * 0.1), Math.round(canvasW * 0.45), Math.round(canvasW * 0.75)];
    }
    const [nmX, custX, ketX] = centers;
    const nmR = Math.round((nmX + custX) / 2);
    const custR = Math.round((custX + ketX) / 2);
    return {
        nm: { L: nmX - (nmR - nmX), R: nmR },
        cust: { L: nmR + 6, R: custR - 6 },
        ket: { L: custR + 6, R: Math.min(canvasW, ketX + (ketX - custR)) - 6 },
    };
}


function isRedArea(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, padY = 10) {
    let { x, y, w, h } = rect;
    if (w <= 2 || h <= 2) return false;
    y = Math.max(0, y - padY);
    h = h + padY * 2;

    const stepX = Math.max(1, Math.floor(w / 18));
    const stepY = Math.max(1, Math.floor(h / 12));
    let redish = 0,
        total = 0;
    for (let yy = y + 1; yy < y + h - 1; yy += stepY) {
        for (let xx = x + 1; xx < x + w - 1; xx += stepX) {
            const [r, g, b, a] = Array.from(ctx.getImageData(xx, yy, 1, 1).data);
            if (a < 12) continue;
            if (r > 165 && r - g > 40 && r - b > 40) redish++;
            total++;
        }
    }
    return total > 0 && redish / total >= 0.08;
}


function buildLineBins(words: OCRWord[]) {
    const centersY = words.map((w) => Math.round((w.y0 + w.y1) / 2)).sort((a, b) => a - b);
    if (!centersY.length) return [] as { y0: number; y1: number }[];
    const bins: { y0: number; y1: number }[] = [];
    let y0 = centersY[0],
        y1 = centersY[0];
    const tol = Math.max(12, Math.round((words.reduce((a, w) => a + (w.y1 - w.y0), 0) / words.length) * 0.85));
    for (let i = 1; i < centersY.length; i++) {
        if (centersY[i] - y1 > tol) {
            bins.push({ y0: y0 - tol, y1: y1 + tol });
            y0 = centersY[i];
            y1 = centersY[i];
        } else {
            y1 = centersY[i];
        }
    }
    bins.push({ y0: y0 - tol, y1: y1 + tol });
    return bins.map((b) => ({ y0: Math.max(0, b.y0), y1: b.y1 + 2 }));
}


function textInBand(words: OCRWord[], y0: number, y1: number, xL: number, xR: number) {
    const picked = words
        .filter((w) => w.y0 >= y0 && w.y1 <= y1 && Math.min(w.x1, xR) - Math.max(w.x0, xL) > 8)
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text);
    return picked.join(" ").replace(/\s+/g, " ").trim();
}


async function recognizeWords(gray: HTMLCanvasElement): Promise<OCRWord[]> {
    const worker = await getWorker("eng+ind").catch(() => getWorker("eng"));

    let src: HTMLCanvasElement = gray;
    try {
        const det: any = await (worker.detect ? worker.detect(gray) : (worker as any).detect?.(gray));
        const deg = Math.round(det?.data?.orientation?.degrees || 0);
        if (deg) src = drawRotated(gray, 360 - deg) as HTMLCanvasElement;
    } catch { }

    try {
        await worker.setParameters({ tessedit_pageseg_mode: String(PSM.SPARSE_TEXT) } as any);
    } catch { }
    let res: any = await worker.recognize(src);
    let words = parseTSV(res?.data?.tsv || "");
    if (words.length >= 30) return words;

    try {
        await worker.setParameters({ tessedit_pageseg_mode: String(PSM.SINGLE_BLOCK) } as any);
    } catch { }
    res = await worker.recognize(src);
    words = parseTSV(res?.data?.tsv || "");

    if (words.length >= 30) return words;
    const up = document.createElement("canvas");
    up.width = Math.round(src.width * 1.6);
    up.height = Math.round(src.height * 1.6);
    up.getContext("2d")!.drawImage(src, 0, 0, up.width, up.height);
    res = await worker.recognize(up);
    return parseTSV(res?.data?.tsv || "");
}


async function parseImageToRows(file: File): Promise<Row[]> {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = URL.createObjectURL(file);
    });

    const { color, cctx, gray } = buildCanvases(img);

    const words0 = await recognizeWords(gray);
    if (!words0.length) return [];
    const words = words0.filter((w) => w.conf >= 12);

    let bands = detectBandsByHeader(words, gray.width);
    if (!bands) bands = detectBandsFallback(words, gray.width);

    const bins = buildLineBins(words);

    const rows: Row[] = [];
    for (const b of bins) {
        const nmRaw = textInBand(words, b.y0, b.y1, bands.nm.L, bands.nm.R);
        const nm = cleanSentraName(nmRaw);

        const custRaw = textInBand(words, b.y0, b.y1, bands.cust.L, bands.cust.R);
        const cust = cleanCustomerName(custRaw);

        if (!nm && !cust) continue;

        const rect = {
            x: Math.max(0, bands.ket.L),
            y: Math.max(0, b.y0),
            w: Math.min(color.width, bands.ket.R) - Math.max(0, bands.ket.L),
            h: Math.min(color.height, b.y1) - Math.max(0, b.y0),
        };
        const red = isRedArea(cctx, rect, 12);

        rows.push({ nm_sentra: nm || "(sentra?)", customername: cust || "(nama?)", tabkur: red });
    }


    const fixed: Row[] = [];
    let lastSentra = "";
    for (const r of rows) {
        let s = r.nm_sentra;
        const valid = /[A-Za-z]/.test(s) && s.split(/\s+/).filter(Boolean).length >= 2;
        if (!valid || s === "(sentra?)") s = lastSentra;
        if (/[A-Za-z]/.test(s)) lastSentra = s || lastSentra;
        fixed.push({ ...r, nm_sentra: s || lastSentra || "(sentra?)" });
    }

    return fixed.filter((r) => (r.nm_sentra + r.customername).replace(/\W/g, "").length >= 3);
}


function rowsToWhatsApp(rows: Row[]) {
    const map = new Map<string, Row[]>();
    const order: string[] = [];
    for (const r of rows) {
        const key = (r.nm_sentra || "").replace(/\s+/g, " ").trim();
        if (!key) continue;
        if (!map.has(key)) {
            map.set(key, []);
            order.push(key);
        }
        map.get(key)!.push(r);
    }

    const out: string[] = [];
    for (const s of order) {
        out.push(s);
        const list = map
            .get(s)!
            .filter((x) => x.customername && x.customername !== "(nama?)")
            .map((r) => `\n${r.customername}${r.tabkur ? " (tabkur)" : ""}`);
        out.push(...list, "\n");
    }
    return out.join("\n").trim();
}


export default function Page() {
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [output, setOutput] = useState("");
    const taRef = useRef<HTMLTextAreaElement>(null);

    const onSelect = useCallback((f: FileList | null) => {
        if (!f?.length) return;
        setFiles((prev) => [...prev, ...Array.from(f)]);
    }, []);

    const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) onSelect(e.dataTransfer.files);
    };

    const process = useCallback(async () => {
        if (!files.length) return;
        setBusy(true);
        try {
            const all: Row[] = [];
            for (const f of files) {
                const rows = await parseImageToRows(f);
                all.push(...rows);
            }
            const text = rowsToWhatsApp(all);
            setOutput(text || "(Tidak ada baris valid yang terbaca)");
            setTimeout(() => taRef.current?.focus(), 0);
        } catch (e) {
            console.error(e);
            setOutput("Terjadi error saat memproses gambar.");
        } finally {
            setBusy(false);
        }
    }, [files]);

    const clearAll = () => {
        setFiles([]);
        setOutput("");
    };
    const canCopy = useMemo(() => output.trim().length > 0, [output]);

    return (
        <div className="space-y-6">
            <div className="card p-6">
                <h1 className="text-xl font-semibold">Scan Foto Tabel</h1>
                <p className="mt-1 text-sm text-gray-600">
                    Upload foto tabel. Sistem mengelompokkan per <b>nm_sentra</b> dan menampilkan <b>customername</b>. Baris dengan
                    sel <b>kolom ket</b> berwarna merah ditandai <b>(tabkur)</b>.
                </p>

                <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()} className="dropzone mt-6">
                    <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => onSelect(e.target.files)}
                        className="hidden"
                        id="filepick"
                    />
                    <label htmlFor="filepick" className="block cursor-pointer">
                        <div className="text-sm font-medium">Klik untuk pilih gambar</div>
                        <div className="text-xs mt-1 text-gray-500">Atau tarik & letakkan di sini (bisa banyak file)</div>
                    </label>
                </div>

                {files.length > 0 && (
                    <div className="mt-4 flex items-center justify-between text-sm">
                        <div className="text-gray-700">Dipilih: {files.length} file</div>
                        <button onClick={clearAll} className="btn-ghost">
                            Reset
                        </button>
                    </div>
                )}

                <div className="mt-4 flex gap-2">
                    <button disabled={!files.length || busy} onClick={process} className="btn-primary">
                        {busy ? "Memproses…" : "Proses Gambar"}
                    </button>
                    <button
                        disabled={!canCopy}
                        onClick={() => navigator.clipboard.writeText(output)}
                        className="btn-ghost disabled:opacity-60"
                    >
                        Salin ke Clipboard
                    </button>
                </div>
            </div>

            <div className="card p-6">
                <label className="label">Hasil (siap paste ke WhatsApp)</label>
                <textarea
                    ref={taRef}
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    rows={16}
                    className="mono mt-2 w-full resize-y rounded-xl border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    placeholder="Hasil akan muncul di sini…"
                />
            </div>
        </div>
    );
}
