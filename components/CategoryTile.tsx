import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text } from "react-native";

import type { Category } from "@/lib/types";

type IconName = ComponentProps<typeof Ionicons>["name"];

// Palette rotated by sort order (the DB no longer stores colors).
const TILE_COLORS = ["#FF6B4A", "#3E8368", "#2E86AB", "#F2B705", "#10241F"];
const DARK_TEXT_TILES = new Set(["#F2B705"]);

export function CategoryTile({ category }: { category: Category }) {
  const color = TILE_COLORS[category.sort_order % TILE_COLORS.length];
  const textColor = DARK_TEXT_TILES.has(color) ? "#10241F" : "white";

  return (
    <Pressable
      onPress={() => router.push(`/category/${category.id}`)}
      style={{ backgroundColor: color }}
      className="category-tile"
    >
      <Ionicons name={category.icon as IconName} size={22} color={textColor} />
      <Text
        style={{ color: textColor }}
        className="font-quicksand-semibold text-sm leading-4"
      >
        {category.name}
      </Text>
    </Pressable>
  );
}
