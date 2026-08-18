# Fara Editor

Instagram Reels, TikTok va YouTube Shorts uchun **telefonning o‘zida** ishlaydigan AI video muharrir.
Video hech qayerga yuklanmaydi — butun montaj, subtitr va render Android qurilmasi ichida bajariladi.
Tashqariga faqat siz ulagan AI provayderiga nutq transkripsiyasi va montaj rejasi so‘rovi ketadi.

---

## Nima qila oladi

**AI agent — oddiy gap bilan buyruq berasiz**
- “Jimliklarni kesib tashla”, “boshini qiziqarli qil”, “subtitrni inglizchaga tarjima qil”,
  “sekin joylarni 1.5x tezlat”, “rasmlarimni mos joyga qo‘y” — yozasiz, agent bajaradi
- Agent haqiqiy asboblar bilan ishlaydi: kesish, tezlik, rang va effektlar, subtitr uslubi va
  joylashuvi, tarjima, rasm chizish, sizning rasm/videolaringizni joylashtirish, ovoz berish,
  ovoz miksi va format
- Har bir buyruqdan keyin nima o‘zgargani ro‘yxat bo‘lib chiqadi
- **“AI qilganini bekor qil”** — bitta tugma bilan loyiha o‘sha buyruqdan oldingi holatiga qaytadi
- Gemini, Claude, GPT yoki OpenAI-mos har qanday server bilan ishlaydi

**Mening rasm va videolarim**
- Galereyadan bir nechta rasm yoki qisqa video yuklaysiz va har biriga bir og‘iz izoh yozasiz
- Agent gapga qarab ularni to‘g‘ri daqiqada ekranga chiqaradi (kartochka, to‘liq ekran yoki burchak)

**Ovoz berish**
- Telefonning o‘z ovozi (bepul, internetsiz), ElevenLabs, OpenAI yoki Gemini
- Agent aytilgan matnni o‘qib, videoga miks qiladi; ostidagi ovoz avtomatik pasayadi
- Dublyaj: subtitrni tarjima qilib, o‘sha tilda gapirtirish ham mumkin

**Avto-montaj**
- Jimliklarni topib avtomatik kesadi (sezgirlik, pauza uzunligi va chetlarga zaxira sozlanadi)
- Kadr almashinuvini aniqlaydi va har bir dubldan alohida bo‘lak yasaydi
- Bo‘laklarni cho‘zish, o‘chirish, 0.5x–3x tezlik (ovoz ohangi buzilmaydi)
- Bo‘laklar orasiga o‘tish effektlari: fade, erish, yorug‘lik, siljish, doira, piksel

**Subtitr — so‘zma-so‘z sinxron**
- Nutqni so‘z darajasidagi vaqtlar bilan matnga aylantiradi
- 8 ta tayyor uslub: Hormozi, Karaoke, Sakrash, Neon, Plashka, Toza, Mashinka, Kino
- Aytilayotgan so‘z rangi bilan yonadi; muhim so‘zlar alohida rangda
- Animatsiyalar: sakrash, kuchli sakrash, pastdan chiqish, yumshoq, mashinka
- Shrift, hajm, balandlik, kontur, soya, ranglar — hammasi sozlanadi
- Boshqa tilga tarjima (vaqtlar saqlanadi) va `.srt` eksport

**Jonli ko‘rish**
- Subtitr, effekt, rang, kadr va rasmlarni o‘zgartirsangiz — **darrov ekranda ko‘rinadi**
- Musiqa va AI ovozlari ham jonli eshitiladi: trekni almashtirsangiz yoki balandligini
  o‘zgartirsangiz shu zahoti quloqqa chalinadi, render kutilmaydi
- Subtitr va rasmlarni **barmoq bilan surib** joylashtirasiz
- To‘liq ekran rejimi

Preview GPU’da (Skia) chiziladi: kadr kesimi, zoom, vinyet, chiziqlar, subtitr va rasmlar
render bilan bir xil hisob-kitobdan foydalanadi. Faqat rang gradatsiyasi matritsa bilan
taqriblanadi — “Namuna ko‘rish” tugmasi esa haqiqiy render orqali aniq natijani beradi.

**Kino effektlari**
- Rang: Teal & Orange, Iliq plyonka, Sovuq kino, Yorqin, Qorong‘i, Vintaj, Oq-qora — kuchi sozlanadi
- **Chetlarning qorayishi (vinyet)**, plyonka doni, nur (bloom), o‘tkirlik, rang siljishi
- Kino chiziqlari (letterbox), sekin zoom, zarbga urish, qo‘l silkinishi
- Kamera silkinishini bartaraf qilish (vid.stab, ikki bosqichli)
- O‘z `.cube` LUT faylingizni qo‘shish
- Kadrni to‘ldirish / xira fon / qora chet rejimlari
- **Namuna ko‘rish**: kursor turgan joydan 4 soniyalik haqiqiy render

**Musiqa**
- O‘zingiz yuklagan trek (ilova musiqa tarqatmaydi)
- Gapirganda musiqa avtomatik pasayadi (sidechain ducking)
- Trekdagi zarblarni topadi va kadrni ritmga moslaydi
- Kirish/chiqish fade, takrorlash, boshlanish nuqtasi
- Ovozni tozalash (shovqin, gulduros) va platforma standartiga (-14 LUFS) keltirish

**AI rejissyor — bitta tugma**
“Boshlash” tugmasi bosilganda hammasi o‘zi bajariladi:
- Nutqni so‘zma-so‘z vaqti bilan yozib oladi
- Keraksiz joylarni, uzoq pauzalarni va noto‘g‘ri boshlangan gaplarni kesadi
- Bo‘laklar orasiga mos o‘tish qo‘yadi
- Rang va subtitr uslubini tanlaydi, muhim so‘zlarni belgilaydi
- **Gapirilgan misollarga rasm chizib ekranga chiqaradi** — aniq narsa aytilganda
  (predmet, joy, taqqoslash, natija) shu daqiqada rasm paydo bo‘ladi
- Sarlavha, tavsif va hashtaglar yozadi

Hammasi loyihaga qo‘llanadi, lekin qulflanmaydi — har bir bo‘limda qo‘lda o‘zgartirish mumkin.
Rasmlar uch xil ko‘rinishda chiqadi: kadr yuqorisidagi kartochka, butun ekran, yoki kichik burchak.
Ular subtitr **tagida** joylashadi, ya’ni matnni hech qachon to‘smaydi.

**Montaj oynasi**
- Yuqorida — kadr, o‘rtada — kursor ekran markazida turadigan siljiydigan lenta,
  pastda — asboblar. Barmoq bilan kattalashtirish (pinch) vaqt shkalasini o‘zgartiradi
- Bo‘lakni tanlab chetlaridagi dastakni sursangiz — kesiladi; kursor turgan joydan bo‘lish,
  o‘chirish, tezlik — hammasi bir qatorda
- Lentaning ostida musiqa, ovoz, rasm va subtitr yo‘lakchalari ko‘rinadi
- Yuqoridagi **“Qo‘lda / AI”** tugmasi pastki qismni qo‘lda ishlash va agentga buyruq berish
  o‘rtasida almashtiradi

**Eksport**
- Instagram Reels / Feed, TikTok, YouTube Shorts / YouTube presetlari
- 9:16, 4:5, 1:1, 16:9 · 720p / 1080p / 2K · 24 / 30 / 60 fps
- Koder: telefon chipidagi tezkor koder, libx264 yoki HEVC
- Galereyaga saqlash yoki to‘g‘ridan-to‘g‘ri ulashish

---

## AI kalitlarini ulash

Ilova hech qanday kalit bilan kelmaydi — **o‘zingiznikini** ulaysiz. Kalitlar Android keystore
ichida (`expo-secure-store`) saqlanadi va faqat siz tanlagan provayderga yuboriladi.

**Standart — Google Gemini, bitta kalit bilan.** Gemini ham matn yozadi, ham audioni
to‘g‘ridan-to‘g‘ri o‘qiydi, shuning uchun subtitr uchun alohida kalit kerak emas: ikkala bo‘lim
ham Gemini bo‘lsa, nutq tomoni yuqoridagi kalitni o‘zi oladi.

| Nima uchun | Qo‘llab-quvvatlanadi |
|---|---|
| **AI model** — montaj rejasi, tarjima, post matni | Google Gemini, Anthropic (Claude), OpenAI yoki har qanday OpenAI-mos server (OpenRouter, Groq, Together, o‘zingizniki) |
| **Nutq → matn** — subtitr uchun so‘z vaqtlari | Google Gemini yoki Whisper (OpenAI, Groq, `/audio/transcriptions` bergan har qanday server) |
| **Ovoz** — AI gapirishi, dublyaj | Telefonning o‘zi (kalitsiz, bepul), ElevenLabs, OpenAI yoki Gemini |

**Model nomlari ilovaga yozilmagan.** Kalitni kiritsangiz, ilova provayderning o‘z ro‘yxatini
so‘raydi va nima bo‘lsa shuni ko‘rsatadi — kecha chiqqan model ham darrov ro‘yxatda bo‘ladi,
ilovani yangilash shart emas. Ro‘yxat bo‘sh chiqsa yoki gateway o‘z modelini yashirsa, nomni
qo‘lda kiritish maydoni ham bor.

Ikkalasi ham ixtiyoriy: AI ulanmasa ham kesish, effektlar, musiqa va eksport to‘liq ishlaydi.

---

## Qurish

### Tayyor APK — eng oson yo‘l

Har bir push’dan keyin GitHub Actions APK yig‘adi. **Actions → Build & test → fara-editor-apk**
bo‘limidan yuklab olib, telefonga o‘rnatasiz. (APK debug kalit bilan imzolanadi, ya’ni darrov
o‘rnatiladi; Play Store’ga chiqarish uchun o‘z keystore’ingizni ulashingiz kerak.)

### O‘z kompyuteringizda

Kerak: Node 22+, JDK 17, Android SDK (API 36), va bir marta — ffmpeg-kit AAR fayli.

```bash
npm install               # Skia native kutubxonalarini ham yuklaydi (postinstall)
npm run ffmpeg:fetch      # ffmpeg-kit binarniklarini ./vendor/m2 ga yuklaydi
npm run apk               # prebuild + gradlew assembleRelease
```

Agar `npm ci --ignore-scripts` ishlatsangiz, Skia kutubxonalari yuklanmaydi —
`npx install-skia` ni alohida chaqiring, aks holda CMake “Skia prebuilt binaries not found”
deb to‘xtaydi.

APK shu yerda: `android/app/build/outputs/apk/release/`.

Ishlab chiqish rejimi uchun:

```bash
npx expo run:android
```

### ffmpeg-kit binarniklari haqida

Arthenica 2025-yilda `ffmpeg-kit` loyihasini yopdi va `com.arthenica:ffmpeg-kit-*` artefaktlarini
Maven Central’dan olib tashladi. Binarniklarning o‘zi tarqatiladi (LGPL-3.0, `-gpl` variantlari
uchun GPL-3.0), faqat ularni endi qo‘lda ko‘chirish kerak.

`npm run ffmpeg:fetch` ularni `ffmpeg-kit.sources.json` dagi mirror’lardan qidiradi va
`./vendor/m2` ichida kichik Maven repozitoriysi yasaydi. Ro‘yxatdagi birinchi manzil —
Google’ning Maven Central GCS mirror’i; undan keyin Huawei va Aliyun keladi. Skript yuklangan
faylning zip sarlavhasini tekshiradi, shuning uchun 200 qaytarib xato sahifa bergan mirror
o‘tkazib yuboriladi.

Agar bir kun bu manzillar ham o‘lsa, `node scripts/probe-ffmpeg-mirrors.mjs` tirik manbalarni
qayta topadi (tarmog‘i ochiq mashinada yoki CI’da ishga tushiring). Yoki to‘g‘ridan-to‘g‘ri:

```bash
FFMPEG_KIT_AAR_URL=https://sizning-serveringiz/ffmpeg-kit-full-gpl-6.0-2.aar npm run ffmpeg:fetch
```

CI’da xuddi shu nom bilan repository variable yoki secret qo‘shsangiz kifoya. Faylni qo‘lda
`vendor/m2/com/arthenica/ffmpeg-kit-full-gpl/6.0-2/` ichiga qo‘yib, skriptni qayta ishga tushirsangiz
ham bo‘ladi.

`full-gpl` varianti tanlangan, chunki hamma kerakli qism faqat shunda bor: `libass` (uslubli
subtitr), `libx264`/`libx265` (sifatli eksport), `libmp3lame` (musiqa), `vid.stab` (stabilizatsiya).

Bir eslatma: 6.0-2 binarniklari 4 KB sahifa hajmiga moslangan. Android 15’dagi 16 KB sahifali
qurilmalarda (va Play Store’ning yangi talabida) muammo bo‘lishi mumkin. Sideload qilingan APK
uchun bu odatda sezilmaydi; agar kerak bo‘lsa, `FFMPEG_KIT_AAR_URL` orqali 16 KB’ga moslangan
jamoaviy build’ni ulash mumkin.

---

## Testlar

Render quvuri haqiqiy ffmpeg bilan tekshiriladi — mock qilingan runner faqat satrlar o‘ziga
o‘zi mos kelishini isbotlagan bo‘lardi.

```bash
sudo apt-get install ffmpeg fonts-dejavu-core   # yoki FFMPEG_PATH ni ko‘rsating
npm test
```

Tekshiriladi: har bir subtitr uslubi libass’dan o‘tishi, chiqish davomiyligi timeline
hisobiga mos kelishi, o‘tish effektlari umumiy uzunlikni to‘g‘ri qisqartirishi, ovozsiz manba
ovozsiz fayl berishi, loudness normalizatsiya nishonga tushishi, sidechain ducking musiqani
haqiqatan pasaytirishi, hamda silencedetect / showinfo / astats / ebur128 chiqishlarini o‘qiydigan
parserlar.

---

## Arxitektura

```
modules/ffmpeg/          Kotlin Expo moduli — ffmpeg-kit ustidan progressli ko‘prik
src/ffmpeg/
  pipeline.ts            Loyihadan bitta ffmpeg buyrug‘i yasaydi (filter_complex)
  subtitles.ts           ASS generatori — so‘zma-so‘z karaoke, animatsiyalar
  timeline.ts            Kesish, tezlik va o‘tishlar vaqt hisobi
  filters/               grade · look · motion · frame · overlay · audio · escape
src/analysis/
  parse.ts               ffmpeg loglarini o‘qiydigan toza parserlar
  silence · scenes · beats · loudness · autocut
src/ai/
  models.ts              Provayder katalogidan modellarni jonli olish
  providers/llm.ts       Gemini · Anthropic · OpenAI-mos (hammasi fetch orqali)
  providers/toolChat.ts  Uchala dialektdagi asbob chaqiruvini bitta ko‘rinishga keltiradi
  agentTools.ts          Agent nima qila olishi (JSON-schema)
  agent.ts               Asbob chaqiruv halqasi
  agentExecutor.ts       Chaqiruvlarni loyihaga qo‘llaydi, vaqtlarni qayta bog‘laydi
  transcribe.ts          Audio ajratish, bo‘laklash, so‘z vaqtlari (Gemini yoki Whisper)
  director.ts            Montaj rejasi, o‘tishlar, rasm g‘oyalari, tarjima, post matni
  images.ts              Illyustratsiya yaratish (generateContent yoki predict)
  voice.ts               Ovoz sintezi: telefon · ElevenLabs · OpenAI · Gemini
src/editing/segments.ts  Kesish, bo‘lish, tezlik, dastak bilan cho‘zish (qo‘lda ham, AI ham)
src/preview/
  LivePreview.tsx        Skia bilan jonli kadr
  useMixPlayback.ts      Musiqa va ovozni kursorga moslab jonli ijro etadi
src/services/
  autoEdit.ts            “Bitta tugma” — transkript → tahlil → reja → rasmlar
src/components/CutTimeline.tsx  Markazda kursor turadigan lenta
src/screens/             Home · Editor (lenta + asbob tortmalari) · Settings
src/store/               Loyihalar (AsyncStorage) va sozlamalar (SecureStore)
plugins/withFFmpegKit.js Gradle repozitoriysini ulaydigan Expo config plugin
tests/                   Haqiqiy ffmpeg bilan render va tahlil testlari
```

Muhim tanlov: preview va render bitta hisob-kitobdan foydalanadi — kadr kesimi, zoom, vinyet,
subtitr va rasm joylashuvi ikkalasida ham bir xil koddan chiqadi. Farq faqat rang gradatsiyasida:
ekranda u matritsa bilan taqriblanadi, chunki ffmpeg’ning egri chiziqlarini GPU’da aynan
takrorlab bo‘lmaydi. Shuning uchun “Namuna ko‘rish” tugmasi qolgan — u haqiqiy quvurdan
4 soniyalik render qiladi. Yolg‘on gapiradigan preview umuman preview yo‘qligidan yomonroq.

Agent vaqt bilan qanday ishlashi ham shu qatorda: model doim **asl videoning soati** bilan
gapiradi, chunki kesish uni siljitmaydi. Rasm va ovozlar esa **eksport lentasida** yashaydi, shuning
uchun ular ish boshida asl soatga bog‘lanadi va ish oxirida, montaj aniq bo‘lgach, qaytadan
hisoblanadi. Aynan shu narsa agent butun videoni qayta kesganda ham rasmni o‘z gapiga yopishib
turishiga sabab bo‘ladi.

---

## Nom va logotip

Ilova ichidagi nom, tagline va logotip **Sozlamalar → Ilova nomi va logotipi** bo‘limidan
o‘zgartiriladi — qayta yig‘ish shart emas.

Telefon ekranidagi ikonka va o‘rnatish nomi build vaqtida olinadi:

- ikonka: `assets/icon.png` (1024×1024) va `assets/android-icon-foreground.png`
- o‘rnatish nomi: `app.json` → `expo.name`

O‘z rasmingizni ikonka qilish uchun shu fayllarni almashtirib push qiling — CI yangi APK yig‘adi.
Hozirgi ikonka vaqtinchalik: uslubi mos, lekin uni o‘z rasmingiz bilan almashtirish tavsiya etiladi.

## Litsenziya

Video qayta ishlash `ffmpeg-kit full-gpl` orqali bajariladi, shuning uchun ilova **GPL-3.0**
shartlari asosida tarqatiladi.
