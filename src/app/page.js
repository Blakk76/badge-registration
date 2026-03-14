import { redirect } from "next/navigation";
"use client";
import { useEffect, useState } from "react";

export default function Home() {
  redirect("/login");
}
