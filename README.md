# CraftPulse · Neighbourhood Makers & Live Craft Queue

CraftPulse is a modern hyperlocal artisan and craft commerce web application built in response to the 13 feature requirements and the smart commerce UI design guide.

---

## 🌟 13 Key Features Implemented

1. **Artisan & Customer KYC (Know Your Customer)**
   - **Multi-tier Maker KYC**: Verified badges for government IDs (Aadhaar, MSME Udyam, FSSAI Food Safety, Karnataka Trade License, BIS Hallmark, GST).
   - **Visual KYC Badges**: Displays `Master Guild Certified`, `FSSAI Certified`, `Master Cobbler` on cards and maker profiles.
   - **KYC Management Center**: Maker Studio tab to review credentials, upload documents, and track verification status.
   - **Customer Trust**: Phone OTP and neighbourhood address verified status.

2. **Smooth Micro-Animations**
   - Active craft workbench tool pulsing animation (`@keyframes tool-stitch`).
   - Smooth progress fill bar with cubic-bezier transition.
   - Pulsing live sync indicator and radar map pins.
   - Live ticking countdown timer with second-by-second updates.
   - Modal fade-in and slide-up toast notifications.

3. **Modern App Name & Brand Identity**
   - **Brand Name**: **CraftPulse** (Subtitled: *Neighbourhood Maker Network*).
   - Custom SVG vector logo mark representing interwoven craft loom and needle.

4. **Robust Image & Database Management (Fixing Picture Issues)**
   - **Canvas Image Resizer**: Client-side `<canvas>` compressor downscales user-uploaded images to max 600px / 75% JPEG quality (~30-50KB) to completely prevent `QuotaExceededError`.
   - **Graceful Error Fallbacks**: Automatic `onerror="handleImgError(this, craft)"` swaps in clean bespoke SVG illustrations if an external image is unavailable.
   - **Curated High-Res Photos**: Unsplash CDN imagery for each maker's workshop and individual products.

5. **Logos for General Maker Types (Craft Categories)**
   - Bespoke vector SVG logos for:
     - ✂ **Tailoring & Alteration** (Shears & thread)
     - 👞 **Footwear Repair** (Cobbler shoe & anvil)
     - 🎂 **Artisanal Bakes** (Whisk & baker's cloche)
     - 🏺 **Pottery & Ceramics** (Potter's wheel & vase)
     - 💎 **Jewelry & Silver** (Faceted gemstone & jeweler's hammer)
     - 🪵 **Woodwork & Carpentry** (Wood plane & timber)

6. **Unique Logos for Individual Makers**
   - Bespoke brand logos / monogram seals for each maker:
     - *Needle & Thread Atelier*: Royal Navy & gold tailoring seal.
     - *Sole Stories Cobbler*: Stitched saddle-tan leather brogue patch.
     - *Butter & Bloom Patisserie*: Rose-blush botanical flour & pastry crest.
     - *The Mending Room Studio*: Sage green Sashiko geometric embroidery seal.
     - *Clay & Kiln Studio*: Terracotta stoneware potter's mark.
     - *Aura Silver Works*: Hallmark diamond & silversmith anvil insignia.

7. **Elevated UI/UX Design**
   - Built to match the design guide:
     - Warm Cream background (`#FDFBF5`), Deep Forest Green (`#0F5A45`), Warm Craft Orange (`#E8743B`), Sand (`#ECD9B0`), Charcoal Ink (`#1F2D2A`).
     - Dark theme palette: `#14201C`, `#1F2F29`, `#4FB08A`, `#F0925F`, `#F1EDE0`.
     - Typography: Fraunces serif headings + DM Sans UI typography.
     - Responsive mobile bottom bar + desktop top navigation.

8. **Database Link & State Manager**
   - **Export JSON**: One-click download of the complete database as `craftpulse-db.json`.
   - **Import JSON**: Upload and restore any database backup file.
   - **Cross-Tab Live Sync**: Powered by `BroadcastChannel('craftpulse-sync-v1')` and `localStorage` so changes in Maker Studio immediately update customer views in another tab without refreshing.
   - **State Reset**: One-click reset to rich default sample data.

9. **Real Google Maps Integration**
   - Real turn-by-turn navigation links: `https://www.google.com/maps/dir/?api=1&destination=...`.
   - Accurate landmark addresses in Indiranagar, Bengaluru.
   - Interactive Indiranagar radar canvas map with clickable pins and quick-view drawer.

10. **Dynamic Approximate Timing Engine**
    - Turnaround calculation: `Base Duration + (Queue Orders × 45 mins ÷ Workers)`.
    - Localized human-friendly labels: `Ready in ~45 mins`, `Ready Today, evening`, `Ready in ~2 days`.
    - Real-time countdown timer (`HH:MM:SS`) on active orders ticking every second.

11. **Filter by Specific Rates**
    - Rate filter chips: `All Rates`, `Under ₹200`, `₹200 - ₹500`, `₹500 - ₹1,000`, `₹1,000 & Above`.
    - Interactive Max Starting Price Slider (₹100 to ₹2,500).
    - Sort options: *Fastest Turnaround*, *Price: Low to High*, *Price: High to Low*, *Highest Rated*, *Closest Distance*.

12. **Individual Maker Product Catalog**
    - Product cards featuring: Photo, Title, Description, Craft Time Tag (e.g. `~60 mins`), and Price (`₹450`).
    - Direct **"Order This Item →"** button pre-populates order modal.
    - Maker Studio product creation flow with photo upload.

13. **Workbench Queue Animation**
    - 3-stage animated **Workbench Pipeline**:
      - Slot #1: *On Workbench* (Pulsing tool animation, active artisan badge, estimated minutes left).
      - Slot #2: *Next in Line* (Staging & prep).
      - Slot #3: *Your Estimated Window* (Queue reservation).
    - 5-step milestone stepper (`Requested` ➔ `Accepted` ➔ `In progress` ➔ `Ready` ➔ `Collected`).
    - Maker Studio stage advance controls.

---

## 🚀 How to Run

Open `index.html` in any web browser:
```powershell
Start-Process "C:\Users\KARTHI\.gemini\antigravity\scratch\craftpulse\index.html"
```
Or serve with Python:
```powershell
python -m http.server 8080 --directory "C:\Users\KARTHI\.gemini\antigravity\scratch\craftpulse"
```
Then navigate to `http://localhost:8080`.
