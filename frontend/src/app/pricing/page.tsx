"use client";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for trying out ClearBG.",
    features: [
      "5 images per day",
      "Up to 1080px resolution",
      "PNG download with transparency",
      "Standard processing speed",
    ],
    cta: "Get started free",
    href: "/sign-up",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$9",
    period: "per month",
    description: "For professionals and creators.",
    features: [
      "Unlimited images",
      "Full resolution (up to 8K)",
      "Batch processing (up to 50)",
      "Priority GPU processing",
      "Custom background replacement",
      "Manual edge correction tool",
      "API access (500 credits/mo)",
      "Images stored for 30 days",
    ],
    cta: "Start Pro — $9/mo",
    href: "/checkout?plan=pro",
    highlighted: true,
  },
  {
    name: "API",
    price: "$0.10",
    period: "per image",
    description: "For developers and high volume.",
    features: [
      "Pay per use, no subscription",
      "Full resolution",
      "Batch endpoint",
      "Webhook support",
      "Swagger docs",
      "SLA: 99.9% uptime",
    ],
    cta: "Get API key",
    href: "/sign-up?plan=api",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white pt-32 pb-24 px-6">
      <div className="max-w-5xl mx-auto text-center mb-16">
        <h1 className="text-5xl font-semibold tracking-tight mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-white/40 text-xl">
          Start free. Upgrade when you need more.
        </p>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-3 gap-6">
        {plans.map((plan, i) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`
              relative rounded-2xl p-8 flex flex-col
              ${plan.highlighted
                ? "bg-[#a78bfa]/10 border-2 border-[#a78bfa]/40"
                : "bg-white/2 border border-white/8"
              }
            `}
          >
            {plan.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#a78bfa] text-black text-xs font-semibold rounded-full">
                Most popular
              </div>
            )}

            <div className="mb-8">
              <p className="text-white/50 text-sm font-medium mb-3">{plan.name}</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-semibold">{plan.price}</span>
                <span className="text-white/30 text-sm">/ {plan.period}</span>
              </div>
              <p className="text-white/40 text-sm">{plan.description}</p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={14} className="text-[#a78bfa] mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={plan.href}
              className={`
                block text-center py-3 rounded-full font-medium text-sm transition-colors
                ${plan.highlighted
                  ? "bg-[#a78bfa] text-black hover:bg-[#c4b5fd]"
                  : "border border-white/15 text-white/70 hover:border-white/30 hover:text-white"
                }
              `}
            >
              {plan.cta}
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
