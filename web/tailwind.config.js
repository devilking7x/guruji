/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A12",
        card: "#101018",
        // Primary accent: violet -> indigo gradient system
        accent: "#8B5CF6",
        accentdeep: "#6366F1",
        accentlight: "#A78BFA",
        // Success / positive
        mint: "#10B981",
      },
    },
  },
  plugins: [],
};
