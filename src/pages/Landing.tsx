import { motion } from "framer-motion";
import {
  Languages,
  Globe,
  Shield,
  BookOpen,
  Sparkles,
  ArrowRight,
  Check,
  Zap,
  FileText,
  Volume2,
  Download,
} from "lucide-react";
import { useNavigate } from "react-router";

const features = [
  {
    icon: Languages,
    title: "20 Languages",
    description:
      "Full localization support for Urdu, Arabic, French, Japanese, Spanish, Hindi, Turkish, Chinese, Russian, Korean, and 10 more.",
  },
  {
    icon: Globe,
    title: "Cultural Immersion",
    description:
      "Native-sounding prose with culturally adapted dialogue, honorifics, and emotional register for each market.",
  },
  {
    icon: Shield,
    title: "Censorship Compliance",
    description:
      "Automatic filtering for high-censorship markets with poetic euphemisms and archaic diplomatic language.",
  },
  {
    icon: BookOpen,
    title: "Character Voice Engine",
    description:
      "Locked voice profiles ensure Violet sounds analytical, Xaden sounds dangerous, and Ridoc sounds witty—across all languages.",
  },
  {
    icon: Sparkles,
    title: "18-Phase Pipeline",
    description:
      "Chain-of-Thought processing: glossary pass, voice adaptation, cultural filter, script formatting, and full QA.",
  },
  {
    icon: Volume2,
    title: "Audiobook Notes",
    description:
      "Voice-director instructions for every dialogue line, advising narrators on emotional delivery and tone.",
  },
];

const languages = [
  "Urdu", "Arabic", "French", "Japanese", "Spanish", "Hindi", "Turkish",
  "Chinese", "Russian", "Korean", "German", "Kashmiri", "Romanian",
  "Swahili", "Italian", "Latin", "Indonesian", "Nepali", "Bangla", "Portuguese",
];

const steps = [
  {
    number: "01",
    title: "Paste Your Text",
    description:
      "Input up to 5,000 words of your manuscript. The engine handles chapter segmentation automatically.",
  },
  {
    number: "02",
    title: "Select Target Language",
    description:
      "Choose from 20 pre-selected languages with optional market-context filters for censorship and tone.",
  },
  {
    number: "03",
    title: "Review & Export",
    description:
      "Get your translated text with a full verification report, CSV exports for design teams, and audiobook voice notes.",
  },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Languages className="size-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Empyrean Translator
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#features"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works
            </a>
            <button
              onClick={() => navigate("/auth?returnTo=/translator")}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Launch App
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.08),transparent)]" />
        <div className="max-w-7xl mx-auto px-6 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10 text-sm text-primary mb-6">
              <Zap className="size-3.5" />
              AI-Powered Localization Engine
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1]">
              Translate Epic Fiction{" "}
              <span className="text-muted-foreground">into 20 Languages</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              The Empyrean Translator runs an 18-phase Chain-of-Thought pipeline
              that preserves character voice, cultural tone, and narrative
              stakes—delivering native-sounding prose for every global market.
            </p>
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={() => navigate("/auth?returnTo=/translator")}
                className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
              >
                Start Translating
                <ArrowRight className="size-4" />
              </button>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                See how it works
              </a>
            </div>
          </motion.div>

          {/* Language Grid */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-16 grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-10 gap-3"
          >
            {languages.map((lang, i) => (
              <motion.div
                key={lang}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.03 }}
                className="flex items-center justify-center px-3 py-2 rounded-lg bg-card border border-border/60 text-sm font-medium text-card-foreground hover:border-primary/30 hover:bg-primary/5 transition-all cursor-default"
              >
                {lang}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mb-16"
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Built for Epic Scale
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Every feature is designed to handle the complexity of
              700-page fantasy novels with hundreds of characters, invented
              magic systems, and politically charged narratives.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="group p-6 rounded-2xl bg-card border border-border/60 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all"
              >
                <div className="size-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/10 transition-colors">
                  <feature.icon className="size-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 border-t border-border/40 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mb-16"
          >
            <h2 className="text-3xl font-bold tracking-tight">How It Works</h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Three steps from manuscript to culturally native translation.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.12 }}
                className="relative"
              >
                <div className="text-6xl font-bold text-primary/10 mb-4">
                  {step.number}
                </div>
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-24 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl font-bold tracking-tight mb-6">
                Every Output You Need
              </h2>
              <div className="space-y-4">
                {[
                  {
                    icon: FileText,
                    text: "UTF-8 Unicode-compliant translated manuscript",
                  },
                  {
                    icon: Download,
                    text: "CSV export for map names, rune captions, and endpaper text",
                  },
                  {
                    icon: Volume2,
                    text: "Voice-director notes for audiobook narrators",
                  },
                  {
                    icon: Check,
                    text: "Full verification report with plausibility scoring",
                  },
                  {
                    icon: Shield,
                    text: "Censorship compliance report for each target market",
                  },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-3">
                    <div className="size-6 rounded-md bg-primary/10 flex items-center justify-center mt-0.5 shrink-0">
                      <item.icon className="size-3.5 text-primary" />
                    </div>
                    <span className="text-muted-foreground">{item.text}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl bg-card border border-border/60 p-8 shadow-sm"
            >
              <div className="text-xs font-mono text-muted-foreground mb-4">
                Translation Report — Arabic (High Censorship)
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>Overall Quality</span>
                    <span className="font-medium">92/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: "92%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>Character Consistency</span>
                    <span className="font-medium">95/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: "95%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>Cultural Compliance</span>
                    <span className="font-medium">88/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: "88%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>Glossary Adherence</span>
                    <span className="font-medium">98/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: "98%" }} />
                  </div>
                </div>
              </div>
              <div className="mt-6 p-3 rounded-lg bg-muted/50 border border-border/40">
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Recommendation:</strong>{" "}
                  Intimacy scenes adapted for local market regulations. Explicit
                  anatomical vocabulary replaced with poetic euphemisms.
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto"
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Ready to Translate Your Epic?
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Paste your first chapter, select your target language, and watch
              the Empyrean Translator run its full 18-phase pipeline.
            </p>
            <div className="mt-8">
              <button
                onClick={() => navigate("/auth?returnTo=/translator")}
                className="inline-flex items-center gap-2 px-8 py-4 text-base font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
              >
                Launch the Translator
                <ArrowRight className="size-4" />
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Languages className="size-4" />
            <span>Empyrean Translator</span>
          </div>
          <span>Powered by Freebuff</span>
        </div>
      </footer>
    </div>
  );
}
