---
title: How ZERO ROT works
source: ZERO ROT documentation
url: README.md
---
## The three answers
For every batch ZERO ROT answers three questions: how good is the produce now and how will quality change, how many days of shelf life are left, and what is it worth. Then it recommends one action: sell now, store, or send to another mandi. The farmer always decides.

ಪ್ರತಿ ಸರಕಿಗೆ ZERO ROT ಮೂರು ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸುತ್ತದೆ: ಈಗ ಗುಣಮಟ್ಟ ಹೇಗಿದೆ ಮತ್ತು ಹೇಗೆ ಬದಲಾಗುತ್ತದೆ, ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ, ಮತ್ತು ಎಷ್ಟು ಮೌಲ್ಯ. ನಂತರ ಒಂದು ಸಲಹೆ ನೀಡುತ್ತದೆ: ಈಗ ಮಾರಿ, ಸಂಗ್ರಹಿಸಿ ಅಥವಾ ಬೇರೆ ಮಂಡಿಗೆ ಕಳುಹಿಸಿ. ಅಂತಿಮ ನಿರ್ಧಾರ ರೈತರದ್ದೇ.

## How shelf life is predicted
Quality falls faster when it is warmer, when humidity is outside the right range, and after cold damage. The decay engine works hour by hour using the storage temperature and humidity. Shelf life is the time until quality falls below the sellable level (40 out of 100). The range shown comes from running the model 200 times with different plausible parameters.

ಬಿಸಿ ಹೆಚ್ಚಿದ್ದರೆ, ತೇವಾಂಶ ಸರಿಯಿಲ್ಲದಿದ್ದರೆ ಅಥವಾ ಶೀತ ಹಾನಿ ಆದರೆ ಗುಣಮಟ್ಟ ಬೇಗ ಕುಸಿಯುತ್ತದೆ. ಗುಣಮಟ್ಟ 100 ರಲ್ಲಿ 40 ಕ್ಕಿಂತ ಕಡಿಮೆಯಾಗುವವರೆಗಿನ ಸಮಯವೇ ಉಳಿದ ದಿನಗಳು. ತೋರಿಸುವ ವ್ಯಾಪ್ತಿ ಮಾದರಿಯನ್ನು 200 ಬಾರಿ ಓಡಿಸಿ ಪಡೆದದ್ದು.

## What confidence means
Confidence is a data-quality score from 0 to 100, not a probability. It goes up with more real temperature readings, complete batch details and well-sourced parameters. Shed conditions estimated from regional weather lower it; a measured shed temperature raises it.

ವಿಶ್ವಾಸಾರ್ಹತೆ 0 ರಿಂದ 100 ರ ಮಾಹಿತಿ-ಗುಣಮಟ್ಟದ ಅಂಕ, ಸಂಭವನೀಯತೆ ಅಲ್ಲ. ನಿಜವಾದ ತಾಪಮಾನ ಅಳತೆಗಳು ಮತ್ತು ಪೂರ್ಣ ವಿವರಗಳಿದ್ದರೆ ಹೆಚ್ಚುತ್ತದೆ. ಹವಾಮಾನದಿಂದ ಅಂದಾಜು ಮಾಡಿದರೆ ಕಡಿಮೆ; ಶೆಡ್‌ನ ತಾಪಮಾನ ಅಳೆದು ನಮೂದಿಸಿದರೆ ಹೆಚ್ಚುತ್ತದೆ.

## How the value is calculated
Value = saleable weight × market price × grade factor. Saleable weight falls with moisture loss and rotten units. The grade factor falls as quality drops below 85. Net earnings subtract transport, storage rent, handling and mandi commission. Mandi prices in this demo are simulated.

ಮೌಲ್ಯ = ಮಾರಬಹುದಾದ ತೂಕ × ಮಾರುಕಟ್ಟೆ ಬೆಲೆ × ಗ್ರೇಡ್ ಅಂಶ. ನಿವ್ವಳ ಆದಾಯದಿಂದ ಸಾಗಣೆ, ಬಾಡಿಗೆ, ನಿರ್ವಹಣೆ ಮತ್ತು ಮಂಡಿ ಕಮಿಷನ್ ಕಳೆಯಲಾಗುತ್ತದೆ. ಈ ಡೆಮೊದಲ್ಲಿ ಬೆಲೆಗಳು ಅನುಕರಿತ.

## Mandi auctions
Mandi auctions run in the morning. A load that arrives after 10 am waits for the next 6 am auction, and keeps ageing while it waits. ZERO ROT includes this waiting time in every plan.

ಮಂಡಿ ಹರಾಜು ಬೆಳಿಗ್ಗೆ ನಡೆಯುತ್ತದೆ. 10 ಗಂಟೆಯ ನಂತರ ಬಂದ ಸರಕು ಮರುದಿನ ಬೆಳಿಗ್ಗೆ 6 ಗಂಟೆಯ ಹರಾಜಿಗೆ ಕಾಯಬೇಕು, ಆ ಸಮಯದಲ್ಲೂ ಹಳೆಯದಾಗುತ್ತದೆ.

## Cold storage
Cold storage keeps produce at its recommended temperature, which slows decay a lot. It costs rent per kg per day, so storing only makes sense when the later price is high enough to pay for rent and some quality loss. The Store option and the When should I sell planner calculate this.

ಶೀತಲ ಸಂಗ್ರಹ ಸರಿಯಾದ ತಾಪಮಾನದಲ್ಲಿ ಇಟ್ಟು ಹಾಳಾಗುವುದನ್ನು ನಿಧಾನಗೊಳಿಸುತ್ತದೆ. ಆದರೆ ಪ್ರತಿ ಕೆಜಿಗೆ ದಿನದ ಬಾಡಿಗೆ ಇದೆ. ನಂತರದ ಬೆಲೆ ಬಾಡಿಗೆಗಿಂತ ಹೆಚ್ಚು ಲಾಭ ಕೊಟ್ಟಾಗ ಮಾತ್ರ ಸಂಗ್ರಹ ಲಾಭದಾಯಕ.

## Mandi truck and breakdown
When the farmer hands produce to the mandi company's reefer truck, ZERO ROT keeps watching the cargo temperature. If the cooling unit fails, it checks the options (continue, divert to a cold store to re-cool, or sell at a nearer mandi) and recommends the best one. The route only changes after the farmer approves. The saving shown is a simulation estimate from the same moment, not a measured saving.

ರೈತರು ಮಂಡಿ ಕಂಪನಿಯ ಶೀತಲ ಲಾರಿಗೆ ಸರಕು ಕೊಟ್ಟ ನಂತರವೂ ZERO ROT ತಾಪಮಾನ ಗಮನಿಸುತ್ತದೆ. ಶೀತಲೀಕರಣ ಘಟಕ ವಿಫಲವಾದರೆ ಆಯ್ಕೆಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಉತ್ತಮವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತದೆ. ರೈತರು ಅನುಮೋದಿಸಿದ ನಂತರವೇ ಮಾರ್ಗ ಬದಲಾಗುತ್ತದೆ.

## Data sources and honesty
Weather comes from Open-Meteo (real, cached). Road routes come from OSRM (real, cached). Mandi prices and truck sensor readings are simulated in this demo and are labelled so. Storage parameters come from UC Davis fact sheets; some model shapes are engineering assumptions, listed in the parameter audit.

ಹವಾಮಾನ Open-Meteo ಇಂದ (ನಿಜ). ರಸ್ತೆ ಮಾರ್ಗಗಳು OSRM ಇಂದ (ನಿಜ). ಮಂಡಿ ಬೆಲೆ ಮತ್ತು ಲಾರಿ ಸಂವೇದಕ ಅಳತೆಗಳು ಈ ಡೆಮೊದಲ್ಲಿ ಅನುಕರಿತ.
