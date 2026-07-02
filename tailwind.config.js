/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#3E8368",
        dark: { 100: "#10241F" },
        mist: "#F5F7F5",
        foam: "#E7F1EC",
        citrus: "#F2B705",
        coral: "#FF6B4A",
        tide: "#2E86AB",
      },
      fontFamily: {
        quicksand: ["QuickSand-Regular"],
        "quicksand-light": ["QuickSand-Light"],
        "quicksand-medium": ["QuickSand-Medium"],
        "quicksand-semibold": ["QuickSand-SemiBold"],
        "quicksand-bold": ["QuickSand-Bold"],
      },
    },
  },
  plugins: [],
};