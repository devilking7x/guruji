/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: "#d4af37",
        golddeep: "#a8862a",
        ink: "#0b0b10",
        card: "#14141c",
      },
    },
  },
  plugins: [],
};
