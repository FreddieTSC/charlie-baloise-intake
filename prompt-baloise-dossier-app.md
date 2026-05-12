# Prompt: Baloise Dossier Intake App — Charlie bij CED

## Context

Bouw een standalone HTML-webapp waarmee een dossierbeheerder bij CED (expertisekantoor) een nieuwe Baloise-schadeopdracht kan verwerken. De gebruiker sleept een `.msg`-bestand (Outlook-mail) of een PDF (Opdracht / Claim Snapshot) naar de app. De app extraheert automatisch alle relevante gegevens en vult een fictief BuildEx-formulier in.

BuildEx is het dossiermanagementsysteem van CED. We bouwen hier een **fictieve replica** van het BuildEx-invoerscherm zodat de dossierbeheerder de geëxtraheerde data kan controleren, aanpassen en uiteindelijk kopiëren naar het echte systeem (of later via API koppelen).

---

## Wat de app doet (user flow)

1. **Drop zone** — De gebruiker sleept een bestand naar de app (PDF of .msg).
2. **Parsing** — De app herkent het bestandstype:
   - **PDF**: parse de tekst en extraheer velden uit het "Schadeaangifte Snapshot Document" formaat van Baloise.
   - **EML/MSG-body als tekst**: als de gebruiker de e-mailtekst plakt, parse dan de vrije tekst voor aanvullende instructies (vrijstelling, type expertise, verhaal, etc.).
3. **Fictief BuildEx-formulier** — De geëxtraheerde data wordt ingevuld in een formulier dat de look & feel van BuildEx nabootst (zie UI-specificatie hieronder).
4. **Review & kopieer** — De gebruiker kan velden handmatig aanpassen. Er is een "Kopieer als JSON" knop die de volledige `DossierRequest` JSON genereert.

---

## Databronnen & veldmapping

### Bron: Baloise "Schadeaangifte Snapshot Document" (Opdracht.pdf)

Dit PDF-document heeft een vast formaat met deze secties en velden:

```
ALGEMENE INFORMATIE
├── Registratiedetails
│   ├── Registratiedatum          → DatumOntvangst
│   └── Registratie door          → (info)
├── Verzekeringsnemergegevens
│   ├── Voor- en achternaam       → Schadelijder.Info.Naam + Voornaam
│   ├── Adres                     → Schadelijder.Info.Locatie (Straat, Huisnummer, Postcode, Woonplaats, Land)
│   ├── Geboortedatum             → (info)
│   └── Taal                      → Schadelijder.Info.Taal
├── Makelaarsgegevens
│   ├── Naam                      → Derden[type=Makelaar].Info.Naam
│   ├── Makelaarsnummer           → Derden[type=Makelaar].Info.Code
│   └── Adres                     → Derden[type=Makelaar].Info.Locatie

INITIËLE INFORMATIE
├── Polisgegevens
│   └── Polisnummer               → Schadelijder.Info.Polis
├── Risicodetails
│   ├── Voor- en achternaam       → (bevestiging schadelijder)
│   └── Adres                     → LocatieSchade (Straat, Huisnummer, Postcode, Woonplaats)
├── Gegevens Schadedossier
│   ├── Claimnummer               → DossierCode (prefix "26-" + nummer uit e-mail subject)
│   ├── Datum schadegeval         → DatumSchade
│   ├── Product                   → (bepaalt SchadeTypeH)
│   ├── Waarborg                  → SchadeTypeS
│   ├── Oorzaak                   → (aanvullend op SchadeTypeS)
│   ├── Omstandigheden            → BAVrijeTekst / Notas
│   ├── Referentie makelaar       → Derden[type=Makelaar].Info.Referte
│   ├── Derde partij betrokken?   → (flag voor Derden-sectie)
│   └── Opmerking                 → BAVrijeTekst / Notas
├── Betrokken Partijen (0..n)
│   ├── Rol                       → Derden[n].Info.Type (bijv. "Derde aansprakelijk")
│   ├── Voor- en achternaam       → Derden[n].Info.Naam + Voornaam
│   ├── Polisnummer               → Derden[n].Info.Polis
│   ├── Verzekeringsmaatschappij  → Derden[n].Info.Correspondent
│   ├── Adres                     → Derden[n].Info.Locatie
│   ├── Telefoonnummer            → Derden[n].Info.Telefoon
│   └── Emailadres                → Derden[n].Info.Email
├── Schaderaming
│   ├── Klantenvoordeel?          → Tarificatie (Ja→"Klantenvoordeel", Nee→standaard)
│   ├── Bedrag                    → Schadebedrag / Claim
│   └── Franchise                 → Vrijstelling

BETALINGSGEGEVENS
├── Voor- en achternaam begunstigde → (info)
├── Bankrekening                    → (info)
└── BTW-details                     → (info)
```

### Bron: E-mailtekst van Baloise-beheerder

De e-mail bevat vrije tekst met aanvullende instructies. Herken deze patronen:

| Patroon in e-mail | Doel | Mapping |
|---|---|---|
| `Vrijstelling: €xxx` of `Vrijst: klantv.` | Vrijstellingsbedrag of klantenvoordeel | Vrijstelling / Tarificatie |
| `Polis loopt van ... tot ...` | Polisperiode | Notas |
| `Graag tegensprekelijke expertise` | Type expertise | ExpertiseMethode = "Tegensprekelijk" |
| `Verhaal op ...` | Verhaalsmogelijkheid | Verhaal |
| `BA bedrijven` / `BA BOUW` | Type dossier | SchadeTypeH |
| `waterschade` / `brand` / `aanrijding` | Schadetype | SchadeTypeS |
| Naam + functie afzender | Baloise-contactpersoon | Derden[type=Maatschappij].Info |
| `ons dossier <BREX ...>` of `ref: B26...` | Baloise referentienummer | Derden[type=Maatschappij].Info.Referte |

### Afgeleide/vaste waarden voor Baloise-dossiers

| Veld | Waarde | Toelichting |
|---|---|---|
| Netwerk | "Schade" | Altijd voor Baloise |
| Kantoor | "Premium Noord - ANTWERPEN" | Standaard CED-kantoor |
| Expert | (leeg, handmatig toewijzen) | |
| Beheerder | (leeg, handmatig toewijzen) | |
| ExternPlatform | "Baloise" | Herkomst |
| RoerendOnroerend | Afgeleid uit Product | "Handel Plus" → Onroerend, etc. |

---

## DossierRequest datamodel (volledig schema)

Gebruik dit TypeScript-type als basis voor de JSON-output:

```typescript
interface DossierRequest {
  DossierCode: string;              // "26-552994"
  DatumOntvangst: string;           // ISO date
  DatumSchade: string | null;       // ISO date
  DatumEersteContact: string | null;
  DatumGepland: string | null;
  DatumAfsluiting: string | null;
  
  Schadelijder: DossierDerde;       // Verzekeringsnemer
  LocatieSchade: LocatieInfo;       // Risicoadres
  
  SchadeTypeH: string;              // Hoofdcategorie: "Brand", "BA Bedrijven", "BA Bouw", etc.
  SchadeTypeS: string;              // Subcategorie: "Waterschade", "Stormschade", etc.
  Schadebedrag: number | null;
  Claim: number | null;
  Vrijstelling: number | null;
  KapitaalGebouw: number | null;
  
  Verhaal: string;                  // Vrije tekst verhaalinfo
  BAVrijeTekst: string;             // Omstandigheden + opmerkingen
  
  Expert: string;
  Beheerder: string;
  Kantoor: string;
  Netwerk: string;
  Tarificatie: string;
  RoerendOnroerend: string;
  ExternPlatform: string;
  ExpertiseMethode: string;         // "Tegensprekelijk", "Eenzijdig", etc.
  ExpertiseMethodeProcedure: string;
  ExterneCommunicatie: string;
  
  Derden: DossierDerde[];           // Maatschappij, makelaar, tegenpartij, etc.
  Notas: string[];                  // Vrije notities
  
  Identificatiefiche: string;
  Verslag: string;
  Foutcode: string;
  JsonString: string;
}

interface DossierDerde {
  Info: DossierPartij;
  Partijen: DossierPartij[];
}

interface DossierPartij {
  Type: string;          // "Maatschappij", "Makelaar", "Schadelijder", "Derde aansprakelijk", "Expert tegenpartij"
  Naam: string;
  Voornaam: string;
  Code: string;          // Makelaarsnummer, etc.
  Polis: string;
  Referte: string;       // Referentienummer
  Correspondent: string; // Verzekeringsmaatschappij naam
  Email: string;
  Telefoon: string;
  Mobiel: string;
  Taal: string;          // "NLD", "FRA"
  BTWNummer: string;
  Locatie: LocatieInfo;
}

interface LocatieInfo {
  Straat: string;
  Huisnummer: string;
  Postcode: string;
  Woonplaats: string;
  Land: string;          // Default "BE"
}
```

---

## UI-specificatie: fictief BuildEx-formulier

### Layout

De app bootst het BuildEx-scherm na met een tabstructuur. Bouw deze tabbladen:

#### Tab 1: "Overzicht" (hoofdtab, standaard actief)
Bovenaan een **headerbalk** met:
- DossierCode (groot, bold)
- DatumOntvangst | Status: "Ontvangst" | LocatieSchade (samengevat)
- Maatschappij: "BALOISE" | Schadelijder naam

Daaronder het formulier in twee kolommen:

**Linkerkolom — Dossiergegevens:**
- Dossiernummer (readonly, geel achtergrond zoals BuildEx)
- Kantoor (dropdown)
- Expert (tekstveld)
- Beheerder (tekstveld)
- Netwerk (dropdown: Schade)
- Status dossier

**Rechterkolom — Partijen:**
- Blok "Maatschappij": Naam, Referte, Polisnummer, Contact
- Blok "Schadelijder": Naam, Adres (straat, nr, postcode, woonplaats), Telefoon, Email, Taal
- Blok "Derden" (herhaalbaar): Type, Naam, Adres, Polis, Verzekeraar

#### Tab 2: "Schadegegevens"
- Datum schadegeval
- Locatie schade (apart adresblok)
- SchadeTypeH (dropdown)
- SchadeTypeS (dropdown)
- Schadebedrag
- Vrijstelling
- Klantenvoordeel (checkbox)
- RoerendOnroerend (dropdown)
- ExpertiseMethode (dropdown: Tegensprekelijk / Eenzijdig / Minnelijk)
- Omstandigheden (textarea, groot)
- Verhaal (textarea)

#### Tab 3: "Documenten"
- Lijst van bijlagen uit de opdracht (naam, type, grootte)
- Geëxtraheerd uit de .msg of meegegeven PDFs

#### Tab 4: "JSON Output"
- Readonly textarea met de volledige DossierRequest als formatted JSON
- "Kopieer naar klembord" knop

### Visuele stijl

De app moet de **BuildEx look & feel** combineren met **Charlie branding**:

**BuildEx-elementen (nabootsen):**
- Toolbar bovenaan met tabbladen (grijze achtergrond, actieve tab wit)
- Velden met labels links, input rechts
- Gele achtergrond (#FFF8DC) voor readonly/berekende velden
- Gridlines en borders rond secties
- Compacte layout, kleine font (12-13px)
- Dropdowns met standaard HTML select-styling

**Charlie-branding (toevoegen):**
- Header met Charlie logo (gebruik onderstaande inline SVG)
- Subtitel: "DOSSIER INTAKE — BALOISE" in Inter, uppercase, letter-spacing 5px, kleur #1C5C8A
- Primaire actieknoppen in CED Blauw (#3899DD), hover: #2D7DBE
- Achtergrond: licht cream (#FAEEDA) voor de drop zone, wit (#FFFFFF) voor het formulier
- Statusbalk onderin met CED Navy (#1C054F) achtergrond, witte tekst

**Charlie logo — embed deze SVG inline in de app header:**

Horizontale lockup (icoon + naam, gebruik in de header):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 120" role="img" aria-label="Charlie" style="height: 48px;">
  <rect x="20" y="30" width="60" height="60" rx="14" fill="#1C054F"/>
  <text x="50" y="78" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="400" font-size="42" fill="#FAEEDA">C<tspan fill="#3899DD">.</tspan></text>
  <text x="105" y="86" font-family="Georgia, serif" font-style="italic" font-weight="400" font-size="68" fill="#1C054F">Ch<tspan fill="#3899DD">a</tspan>rl<tspan fill="#3899DD">i</tspan>e</text>
</svg>
```

Alleen wordmark (alternatief voor smallere headers):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 160" role="img" aria-label="Charlie" style="height: 36px;">
  <text x="270" y="120" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="400" font-size="120" fill="#1C054F">Ch<tspan fill="#3899DD">a</tspan>rl<tspan fill="#3899DD">i</tspan>e</text>
</svg>
```

**Kleurenpalet (compleet):**

| Token | Hex | Gebruik |
|---|---|---|
| CED Navy | `#1C054F` | Wordmark basis, donkere achtergronden, primaire tekst |
| CED Blauw | `#3899DD` | Letters "a"+"i" in logo, actieknoppen, links, accenten |
| Cream | `#FAEEDA` | Drop zone achtergrond, logo-icoon tekst |
| Blauw-licht | `#6BB6E8` | Blauw op donkere achtergrond, hover states |
| Blauw-diep | `#1C5C8A` | Subtitels, secundaire tekst |
| CED Groen | `#86BC34` | Success states, bevestigingen |
| CED Paars | `#56238E` | Waarschuwingen (sparingly) |

**Typografie:**
- Labels: Inter Medium, 12px, #333
- Input: Inter Regular, 13px, #1C054F
- Headers: Inter SemiBold, 14px
- Subtitels/tags: Inter Regular, 11px, uppercase, letter-spacing 3-5px
- Charlie wordmark: Georgia italic (NOOIT rechtopstaand)
- Laad Inter via: `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`

**Logo-regels:**
- De letters "a" en "i" zijn ALTIJD blauw (#3899DD), de rest ALTIJD navy (#1C054F)
- Het logo is altijd italic — nooit rechtopstaand
- Minimaal 0.5× de hoogte als witruimte rondom
- Geen schaduwen, gradients of effecten op het logo

---

## PDF-parsing logica

De "Schadeaangifte Snapshot Document" van Baloise heeft een voorspelbaar formaat. Parse het als volgt:

```
1. Zoek "Claimnummer" → volgende regel = claimnummer (bijv. "B26B0295")
2. Zoek "Registratiedatum" → volgende regel = datum (formaat DD.MM.YYYY)
3. Zoek "Verzekeringsnemergegevens" sectie:
   - "Voor- en achternaam" → volgende regel = naam
   - "Adres" → volgende regel = adres (formaat: "STRAAT NR - POSTCODE PLAATS LAND")
   - "Taal" → volgende regel = taalcode
4. Zoek "Makelaarsgegevens" sectie:
   - "Naam" → makelaarsnaam
   - "Makelaarsnummer" → code
   - "Adres" → adres
5. Zoek "Polisgegevens":
   - "Polisnummer" → volgende regel = polisnummer
6. Zoek "Risicodetails":
   - "Adres" → risicoadres (= LocatieSchade)
7. Zoek "Gegevens Schadedossier":
   - "Datum schadegeval" → DD.MM.YYYY
   - "Product" → product type
   - "Waarborg" → waarborg type
   - "Oorzaak" → oorzaak
   - "Omstandigheden" → omstandigheden
   - "Referentie makelaar" → makelaar referte
   - "Opmerking" → vrije tekst
8. Zoek "Betrokken Partijen" (kan meerdere keren voorkomen):
   - Per partij: Rol, Naam, Polis, Verzekeringsmaatschappij, Adres, Tel, Email
9. Zoek "Schaderaming":
   - "Klantenvoordeel?" → Ja/Nee
   - "Franchise" → bedrag (formaat: -€xxx,xx of €xxx)
   - "Bedrag" of "Totaal Bedrag" → schadebedrag
```

### Adres-parsing

Baloise-adressen komen in twee formaten:
- `STRAAT NR - POSTCODE WOONPLAATS LAND` (bijv. "Notelarestraat 14 - 3830 WELLEN BE")
- Meerdere regels: straat+nr op regel 1, postcode+woonplaats+land op regel 2

Parse regex: `^(.+?)\s+(\d+[A-Za-z]?(?:\s*(?:bus|Bus)\s*\w+)?)\s*[-–]\s*(\d{4})\s+(.+?)\s+(BE|NL|FR|DE|LU)?\s*$`

Of multiline:
- Regel 1: `STRAAT HUISNUMMER`
- Regel 2: `POSTCODE WOONPLAATS LAND`

### E-mailtekst parsing

Wanneer de gebruiker e-mailtekst plakt (uit het .msg bestand), zoek naar:
- `Vrijstelling:` gevolgd door bedrag of "klantv." / "klantenvoordeel"
- `Polis:` gevolgd door polistype
- `tegensprekelijke expertise` → ExpertiseMethode
- `Verhaal op` → Verhaal veld
- `Bestek:` gevolgd door bedrag → Schadebedrag
- Naam + functie van de afzender (onderaan de mail) → Baloise contactpersoon
- `ons dossier` / `ref:` / `B26...` → Baloise referentienummer
- Dossiernummer in subject: `26-XXXXXX`

---

## Technische vereisten

- **Eén HTML-bestand**, geen externe dependencies behalve:
  - PDF.js via CDN (`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/`) voor PDF-parsing
  - Geen framework nodig — vanilla JS is prima
- **Drag & drop** voor bestanden
- **Tekst-plak zone** als alternatief (voor e-mailtekst)
- **Responsive** maar primair desktop (1200px+)
- **LocalStorage**: sla het laatst gegenereerde dossier op zodat het bij refresh niet verloren gaat (optioneel, als de omgeving dit toestaat, anders in-memory)
- **Export**: "Kopieer JSON" knop + optioneel "Download JSON" knop

---

## Voorbeeldmapping (concreet voorbeeld)

### Input: e-mail + Opdracht.pdf van dossier 26-553486

**E-mailtekst:**
> Betreft waterinsijpeling via dak.
> Verhaal op dakwerker?
> Polis loopt van 21/06/2025 tot 01/10/2025
> Vrijstelling 325,94 eur
> Graag tegensprekelijke expertise.

**Opdracht.pdf velden:**
- Claimnummer: B26B0295
- Registratiedatum: 23.03.2026
- Verzekeringsnemer: SIWEL BV, Notelarestraat 14, 3830 WELLEN
- Polisnummer: 3402111
- Product: Handel Plus - Categorie Horeca eigenaar/uitbater
- Datum schadegeval: 08.07.2025
- Waarborg: Waterschade en schade door stookolie
- Oorzaak: Binnendringen van atmosferische neerslag
- Omstandigheden: Doorheen dak of dakterras
- Opmerking: POLIS OPGEZEGD OP 01/10/2025. WATERINSIJPELING IN HET GEBOUW DOOR DAKWERKEN VAN BUREN.
- Derde partij: LUDO VAN GEEL (Derde aansprakelijk)
- Klantenvoordeel: Nee
- Franchise: €325,94

### Output: DossierRequest JSON

```json
{
  "DossierCode": "26-553486",
  "DatumOntvangst": "2026-03-23",
  "DatumSchade": "2025-07-08",
  "Schadelijder": {
    "Info": {
      "Type": "Schadelijder",
      "Naam": "SIWEL",
      "Voornaam": "",
      "Polis": "3402111",
      "Taal": "NLD",
      "Locatie": {
        "Straat": "Notelarestraat",
        "Huisnummer": "14",
        "Postcode": "3830",
        "Woonplaats": "WELLEN",
        "Land": "BE"
      }
    },
    "Partijen": []
  },
  "LocatieSchade": {
    "Straat": "Notelarestraat",
    "Huisnummer": "14",
    "Postcode": "3830",
    "Woonplaats": "WELLEN",
    "Land": "BE"
  },
  "SchadeTypeH": "Brand",
  "SchadeTypeS": "Waterschade en schade door stookolie",
  "Vrijstelling": 325.94,
  "Verhaal": "Verhaal op dakwerker?",
  "BAVrijeTekst": "POLIS OPGEZEGD OP 01/10/2025. WATERINSIJPELING IN HET GEBOUW DOOR DAKWERKEN VAN BUREN. Doorheen dak of dakterras.",
  "ExpertiseMethode": "Tegensprekelijk",
  "Kantoor": "Premium Noord - ANTWERPEN",
  "Netwerk": "Schade",
  "ExternPlatform": "Baloise",
  "Tarificatie": "Standaard",
  "RoerendOnroerend": "Onroerend",
  "Derden": [
    {
      "Info": {
        "Type": "Maatschappij",
        "Naam": "BALOISE",
        "Referte": "B26B0295",
        "Correspondent": "Pinky Kam",
        "Email": "pinky.kam@baloise.be"
      },
      "Partijen": []
    },
    {
      "Info": {
        "Type": "Makelaar",
        "Naam": "INDUVER HEUSDEN ZOLDER",
        "Code": "90182",
        "Referte": "2025-02344",
        "Locatie": {
          "Straat": "MARKTPLEIN",
          "Huisnummer": "9, Bus 22",
          "Postcode": "3550",
          "Woonplaats": "HEUSDEN-ZOLDER",
          "Land": "BE"
        }
      },
      "Partijen": []
    },
    {
      "Info": {
        "Type": "Derde aansprakelijk",
        "Naam": "VAN GEEL",
        "Voornaam": "LUDO"
      },
      "Partijen": []
    }
  ],
  "Notas": [
    "Polis loopt van 21/06/2025 tot 01/10/2025",
    "Betreft waterinsijpeling via dak"
  ]
}
```

---

## Tweede voorbeeld: dossier 26-555127

**E-mailtekst:**
> Polis: woning select
> Waarborgen: gebouw + inboedel + diefstal
> Vrijstelling: 321,36 (september 2024)
> Hoedanigheid: eigenaar bewoner
> Risico adres: Drinkwaterstraat 26 3000 Leuven
> Bestek: 62199,00 EUR excl btw
> Omstandigheden: klant claimt waterschade door insijpeling van regenwater via dakterras van de buur
> Wij hebben de buur reeds in gebreke gesteld (zie bijlage).
> Gelieve een tegensprekelijke expertise te organiseren.

**Verwachte output:**
```json
{
  "DossierCode": "26-555127",
  "DatumSchade": "2024-09-25",
  "Schadelijder": {
    "Info": {
      "Naam": "HANSEBOUT",
      "Voornaam": "KRISTIEN",
      "Polis": "3778603",
      "Taal": "NLD",
      "Locatie": {
        "Straat": "Drinkwaterstraat",
        "Huisnummer": "26",
        "Postcode": "3000",
        "Woonplaats": "LEUVEN",
        "Land": "BE"
      }
    }
  },
  "LocatieSchade": {
    "Straat": "Drinkwaterstraat",
    "Huisnummer": "26",
    "Postcode": "3000",
    "Woonplaats": "LEUVEN",
    "Land": "BE"
  },
  "Schadebedrag": 62199.00,
  "Vrijstelling": 321.36,
  "ExpertiseMethode": "Tegensprekelijk",
  "Verhaal": "Buur reeds in gebreke gesteld. Waterschade door insijpeling van regenwater via dakterras van de buur.",
  "Derden": [
    {
      "Info": {
        "Type": "Derde aansprakelijk",
        "Naam": "Zeghers",
        "Voornaam": "Pedro",
        "Telefoon": "0475 35 76 24",
        "Email": "info.pedrozeghers@gmail.com"
      }
    }
  ]
}
```

---

## Belangrijk: edge cases

1. **Naam parsing**: "SIWEL BV" → Naam="SIWEL", Type=bedrijf. "HANSEBOUT KRISTIEN" → Naam="HANSEBOUT", Voornaam="KRISTIEN". Let op: soms staat de volledige naam als één string, soms apart.
2. **Meerdere derden**: Sommige dossiers hebben 2-3 betrokken partijen. Toon ze allemaal.
3. **Ontbrekende velden**: Niet alle velden zijn altijd ingevuld in het Snapshot. Laat lege velden leeg in het formulier (niet "onbekend" of placeholders).
4. **Datumformaat**: Baloise gebruikt DD.MM.YYYY. Converteer naar ISO (YYYY-MM-DD) in de JSON.
5. **Bedragen**: Baloise gebruikt `€xxx,xx` of `+€xxx` of `-€xxx,xx`. Parse het getal, houd rekening met min-teken bij franchise.
6. **Klantenvoordeel**: Als "Ja" → Tarificatie="Klantenvoordeel". Als "klantv." in e-mail → idem.
7. **Subject parsing**: Het dossiernummer (26-XXXXXX) zit altijd in het e-mail subject. De Baloise-referentie (B26...) is een apart nummer.
