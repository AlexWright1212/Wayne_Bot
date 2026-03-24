import { createBrowserRouter } from "react-router";
import { ChatLayout } from "./components/chat-layout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: ChatLayout,
  },
  {
    path: "/chat/:id",
    Component: ChatLayout,
  },
]);
