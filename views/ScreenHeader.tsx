import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

/** VIEW — back button + title header for pushed (non-tab) screens. */
export function ScreenHeader({ title }: { title: string }) {
  return (
    <View className="flex-row items-center gap-3 px-5 pb-3 pt-4">
      <Pressable
        onPress={() => router.back()}
        className="size-10 items-center justify-center rounded-full bg-white"
        hitSlop={8}
      >
        <Ionicons name="arrow-back" size={20} color="#10241F" />
      </Pressable>
      <Text
        numberOfLines={1}
        className="flex-1 font-quicksand-bold text-xl text-dark-100"
      >
        {title}
      </Text>
    </View>
  );
}
