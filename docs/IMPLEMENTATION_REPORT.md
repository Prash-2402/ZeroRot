# Implementation report

Status as of 5–6 Nov 2026. Only items verified end to end are marked complete.

## Verified end to end (phone tab + laptop tab against the real backend)
- QR pairing with PIN (wrong PIN rejected); the laptop network address is detected for the QR link.
- Live entry on the phone → laptop camera flies to the godown; tractor and crates; godown fills with the door open; door closes when loading ends.
- Advanced godown: automatic cooling, sensor tags, cutaway view. Traditional godown: live-weather physics, vents, heat haze, daylight and night lighting.
- Live forecast drives the sky: real rain (2.6 mm/h) and 98% cloud were rendered during testing; the sun position follows the simulated time.
- Scan & bag with the bundled photos: 4 items → A1/A2/A3 → 10/20/10 bags of 25 kg, filled live in the grading hall.
- Decision without a price key asks for a quoted price ("Sell now", net ₹14,218 at ₹18/kg). Groq explanation in English, answer in Kannada with model numbers.
- Dispatch A1 → Bengaluru APMC (68.2 km OSRM road). Checkpoints named live (Kolar, Hosakote taluk, Hoskote, Bangalore East, Bengaluru), passed with times, arrived, unloaded, delivered, with notifications.
- Dispatch A2 → Chintamani; road blocked at km 26 → alternative road from the truck's position (+3.7 km), 10 min stop, barricade and abandoned road shown; arrival at the mandi scene.
- Continuous simulated clock from godown → bagging → road.

## Automated tests
- Backend: 53 passing, including a full field-flow test (pairing → intake → godown control → spoilage/decision → scan & bag → dispatch → checkpoint → reroute → refrigeration fault → arrival → delivery), an open-truck test, station isolation and Groq key rotation.
- Frontend: 14 passing, including solar position and the truck-path mapping (which caught and fixed a 3-unit end-of-route error).

## Needs credentials
- `DATA_GOV_API_KEY` for verified mandi prices (until then: DATA UNAVAILABLE plus manual price).
- Extra Groq keys (`GROQ_API_KEY_1.._3`) are rotated automatically when set.
- HTTPS (`PUBLIC_BASE_URL`) for phone GPS and web push; on plain HTTP over Wi-Fi the phone uses place search and in-app notifications only.

## Not done / limitations
- **3D assets:** built from procedural geometry and canvas textures (no downloaded glTF models). The 3D GPU path was tested in the app's software-rendered browser (it auto-dropped to "medium" quality); performance on your GPU is not yet measured.
- **Grading:** classical OpenCV analysis (no trained model; ONNX inference not implemented). Grades from a photo sample are extrapolated to the lot.
- **Spoilage model:** Q10 decay calibrated to published storage life; the curve shape is not validated against measurements. Onion is not predicted.
- **Rerouting:** uses OSRM alternatives or a detour waypoint. The public OSRM server has no live traffic or closures, so the blockage itself is a test scenario.
- **Map scale:** the journey map is to scale, but the truck and road are drawn larger than scale for visibility.
- **Deployment:** Docker / PostgreSQL were not run (no Docker engine available); SQLite is used locally. The simulation manager is single-process.
- Older v1 engine modules remain in `backend/app/engine/` for their tests; the app does not use them.
