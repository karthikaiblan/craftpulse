# CraftPulse · Royal Neighbourhood Makers & Live Craft Queue

CraftPulse is a modern, lightweight web application connecting local craft guilds (Sneakers & Cobblers, Patisseries & Cakes, Bespoke Tailors, Pottery, Silver Jewelry, and Woodcraft) with neighbourhood patrons through real-time workbench queue transparency.

## Live Website
- **GitHub Pages (24/7 Live):** https://karthikaiblan.github.io/craftpulse/
- **GitHub Repository:** https://github.com/karthikaiblan/craftpulse

## Key Features
1. **Role-Based Authentication**: Strict separation between Customer and Maker views with 1-click quick demo accounts.
2. **Scrolling Maker Logos Marquee**: Animated hero ticker showcasing local guild maker logos with pause-on-hover.
3. **Full-Size Maker Cards**: Large cover photos with details, rating, turnaround time, and distance overlaid above the image.
4. **Visual Craft Category Cards**: High-resolution photo cards for Footwear, Cakes, Tailoring, Ceramics, Jewelry, and Woodcraft.
5. **Budget & Rate Tiers**: Filter by Pocket Friendly (<₹200), Artisan Standard (₹200–₹500), Master Crafted (₹500–₹1,000), and Royal Bespoke (₹1,000+).
6. **Approximate Timing**: Displays human-friendly turnaround estimates (e.g. Approx. 1–3 hrs) instead of ticking countdowns.
7. **Ready Condition Payment & Tax Invoice**:
   - Order readiness triggers the "Pay & Generate Invoice" flow.
   - Cash on Delivery (COD) and Online UPI (with mock QR code & payment simulator).
   - Instant printable digital tax invoice generation.
8. **Mobile Bottom Navigation Bar**: Fixed, thumb-friendly navigation bar for smartphone screens.
9. **Zero-Dependency Architecture**: Built using pure HTML5, CSS3, and JavaScript (ES6+) with localStorage persistence and BroadcastChannel real-time sync.

## How to Run Locally
Simply double-click `index.html` in any web browser, or run:
```bash
python -m http.server 8080
```
and open `http://localhost:8080`.
