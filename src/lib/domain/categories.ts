export const CATEGORIES = [
  "housing",
  "utilities",
  "phone_internet",
  "insurance",
  "loan",
  "credit_card",
  "subscription",
  "transportation",
  "health",
  "education",
  "taxes",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  housing: "Housing",
  utilities: "Utilities",
  phone_internet: "Phone & internet",
  insurance: "Insurance",
  loan: "Loan",
  credit_card: "Credit card",
  subscription: "Subscription",
  transportation: "Transportation",
  health: "Health",
  education: "Education",
  taxes: "Taxes",
  other: "Other",
};

/** "For the business?" on a bill. Only business and mixed bills are shared with Norfleet One (with the share). */
export const BUSINESS_USES = ["unclassified", "business", "personal", "mixed"] as const;
export type BusinessUse = (typeof BUSINESS_USES)[number];
export const BUSINESS_USE_LABELS: Record<BusinessUse, string> = {
  unclassified: "Not sorted yet",
  business: "Business",
  personal: "Personal",
  mixed: "Partly business",
};
