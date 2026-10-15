/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./views/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#1B87C9",
        dark: { 100: "#0F2A3D" },
        mist: "#F4F8FB",
        foam: "#E3F2FB",
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