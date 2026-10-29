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
