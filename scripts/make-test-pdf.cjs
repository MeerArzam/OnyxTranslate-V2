// Generates the multi-page test PDF for the live 20-language E2E test.
// Run: node scripts/make-test-pdf.cjs  → writes /tmp/onyx-test-book.pdf
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");

const PAGE_TEXTS = [
  `Chapter 1: The Storm Within

Violet gripped the reins of Tairn's saddle, her knuckles white against the worn leather. The wind screamed past her ears as they climbed higher, the peaks of the Venin Mountains disappearing into roiling clouds below.

"You're afraid," Xaden's voice came through the bond, not a question but a statement. Cold. Certain.

"I'm not afraid," she lied, her internal voice cracking with the weight of the lie. She could feel his amusement through the connection, dark and possessive, like he could taste her fear and found it delicious.

*You are mine,* his thoughts echoed through the telepathic link, the dragon's telepathy cutting through her defenses like a blade through silk. *And I do not share.*

Violet's stomach dropped as Tairn banked sharply, and she caught a glimpse of the battlefield below. Wards flickered, Riders fell, and the sigils on their uniforms were torn and bloodied. This was no training exercise. This was war.`,

  `"Holy shit," Ridoc muttered from beside her, his dragon banking in formation. "Remind me again why we volunteered for this?"

"Because we're Scribes," Violet shot back, her voice sharp with righteous fury. "And someone has to record what happens here."

The truth was darker than any of them knew. The Empyrean was watching. The Sages were moving. And somewhere in the shadows, Xaden Riorson was playing a game that could burn the world.

She could feel his gaze on her even now, across the distance, across the Wards, across everything that stood between them. His possessive, dangerous presence burned through her thoughts like wildfire.

"Violet," Dain's formal voice crackled through the communication ward. "Report to the Mending Hall immediately. That's an order."

She didn't need to ask why. She could already feel the pain building in her left side, the old injury that never fully healed, the one that reminded her every day of what she had sacrificed to become a Dragon Rider.`,

  `"I'm on my way," she said, forcing steadiness into her voice.

Xaden's thoughts brushed against hers one last time before she shut the connection: *Be careful. The battle is not what it seems.*

And then she was diving, Tairn screaming into the wind, the world falling away beneath her as she raced toward whatever destiny awaited in the Mending Hall below.

The runes carved into the ancient stone walls pulsed with a faint, sickly light. Violet could feel them, could feel the power they held, the Wards they maintained, the secrets they guarded.

"Begin," the Scribe Master said, his voice flat with the authority of someone who had seen too many battles.

Violet closed her eyes and reached for the Source. The power flooded through her like molten iron, burning, consuming, transforming. She was a Conduit now, a vessel for something older and more terrible than anyone in Navarre understood.`,

  `And as the magic took hold, she understood at last what Xaden had been trying to tell her. The war was not between Navarre and Tyrrendor. The war was between the living and the dead. And the line between them was thinner than anyone dared to imagine.

"Squad Leaders to the front," the Wingleader barked across the courtyard. "Cadets, form up on your Squad Leaders. This is not a drill."

The Battle Wards shimmered overhead as the first wave of Venin crested the ridge. Violet drew her signet's power through the bond, and Tairn roared approval somewhere behind her eyes.

"Hold the line," Xaden commanded, and there was something new in his voice. Respect, maybe. Or fear.

"Mavens do not retreat," one of the Sages whispered through the chaos, and Violet understood that some powers are older than the Empyrean itself.`,

  `The Rune carved above the gate began to glow. Violet had read about this in the Archives at Basgiath, but reading was nothing like standing beneath it while the sky burned.

"Ridoc, get the Civics out of here," she shouted. "Dain, take the western flank. I'll hold the Mending ward."

"You will do no such thing," Xaden said. "You are mine to protect, Violence. That was never a request."

*Then fight beside me,* she answered through the bond. *Or get out of my way.*

And Tairn, ancient and furious and hers, dove straight into the fire.

End of Chapter 1.`,
];

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  for (const pageText of PAGE_TEXTS) {
    const page = doc.addPage([595, 842]); // A4
    const margin = 56;
    const maxWidth = 595 - margin * 2;
    const size = 11;
    const lineHeight = 16;

    let y = 842 - margin;
    for (const para of pageText.split("\n\n")) {
      const isHeading = para.startsWith("Chapter ");
      const words = para.split(/\s+/);
      let line = "";
      const lines = [];
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(test, size) > maxWidth) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      for (const l of lines) {
        page.drawText(l, {
          x: margin,
          y: y - size,
          size: isHeading && l === lines[0] ? 16 : size,
          font: isHeading && l === lines[0] ? bold : font,
          color: rgb(0.05, 0.05, 0.1),
        });
        y -= isHeading && l === lines[0] ? 24 : lineHeight;
      }
      y -= lineHeight * 0.6; // paragraph gap
    }
  }

  const bytes = await doc.save();
  fs.writeFileSync("/tmp/onyx-test-book.pdf", bytes);
  console.log("WROTE /tmp/onyx-test-book.pdf", bytes.length, "bytes,", PAGE_TEXTS.length, "pages");
})();
