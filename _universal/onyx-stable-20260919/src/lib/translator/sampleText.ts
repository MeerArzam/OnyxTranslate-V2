/**
 * src/lib/translator/sampleText.ts — P6 dead-code audit result.
 *
 * engine.ts (999 lines: VLY/DeepSeek neural pipeline, terminology IndexedDB,
 * CSV exports) had exactly TWO live consumers in the app: generateSampleText
 * and the TranslationMode type. The dead pipeline (vlyTranslate references,
 * './storage' IndexedDB terminology, neural model loading) was removed; the
 * live core lives here. The original engine.ts is preserved verbatim in the
 * frozen archive (_universal/onyx-stable) and in git history.
 */

export type TranslationMode = "vly" | "neural" | "glossary";

export function generateSampleText(): string {
  return `Chapter 1: The Storm Within

Violet gripped the reins of Tairn's saddle, her knuckles white against the worn leather. The wind screamed past her ears as they climbed higher, the peaks of the Venin Mountains disappearing into roiling clouds below.

"You're afraid," Xaden's voice came through the bond, not a question but a statement. Cold. Certain.

"I'm not afraid," she lied, her internal voice cracking with the weight of the lie. She could feel his amusement through the connection, dark and possessive, like he could taste her fear and found it delicious.

*You are mine,* his thoughts echoed through the telepathic link, the dragon's telepathy cutting through her defenses like a blade through silk. *And I do not share.*

Violet's stomach dropped as Tairn banked sharply, and she caught a glimpse of the battlefield below—Wards flickering, Riders falling, the sigils on their uniforms torn and bloodied. This was no training exercise. This was war.

"Holy shit," Ridoc muttered from beside her, his dragon banking in formation. "Remind me again why we volunteered for this?"

"Because we're Scribes," Violet shot back, her voice sharp with righteous fury. "And someone has to record what happens here."

The truth was darker than any of them knew. The Empyrean was watching. The Sages were moving. And somewhere in the shadows, Xaden Riorson was playing a game that could burn the world.

She could feel his gaze on her even now, across the distance, across the Wards, across everything that stood between them. His possessive, dangerous presence burned through her thoughts like wildfire.

"Violet," Dain's formal voice crackled through the communication ward. "Report to the Mending Hall immediately. That's an order."

She didn't need to ask why. She could already feel the pain building in her left side—the old injury, the one that never fully healed, the one that reminded her every day of what she'd sacrificed to become a Dragon Rider.

"I'm on my way," she said, forcing steadiness into her voice.

Xaden's thoughts brushed against hers one last time before she shut the connection: *Be careful. The battle is not what it seems.*

And then she was diving, Tairn screaming into the wind, the world falling away beneath her as she raced toward whatever destiny awaited in the Mending Hall below.

The runes carved into the ancient stone walls pulsed with a faint, sickly light. Violet could feel them—could feel the power they held, the Wards they maintained, the secrets they guarded.

"Begin," the Scribe Master said, his voice flat with the authority of someone who had seen too many battles.

Violet closed her eyes and reached for the Source. The power flooded through her like molten iron, burning, consuming, transforming. She was a Conduit now, a vessel for something older and more terrible than anyone in Navarre understood.

And as the magic took hold, she understood at last what Xaden had been trying to tell her. The war was not between Navarre and Tyrrendor. The war was between the living and the dead. And the line between them was thinner than anyone dared to imagine.`;
}
