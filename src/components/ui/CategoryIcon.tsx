import { BookOpen, Car, CreditCard, FileText, HeartPulse, Home, Landmark, Repeat, Shield, Wifi, Zap, Receipt } from "lucide-react";
import type { Category } from "@/lib/domain/categories";

const ICONS: Record<Category, typeof Home> = {
  housing: Home,
  utilities: Zap,
  phone_internet: Wifi,
  insurance: Shield,
  loan: Landmark,
  credit_card: CreditCard,
  subscription: Repeat,
  transportation: Car,
  health: HeartPulse,
  education: BookOpen,
  taxes: FileText,
  other: Receipt,
};

export function CategoryIcon({ category, className = "" }: { category: string; className?: string }) {
  const Icon = ICONS[category as Category] ?? Receipt;
  return (
    <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-lime ${className}`} aria-hidden>
      <Icon size={20} strokeWidth={2.2} />
    </span>
  );
}
