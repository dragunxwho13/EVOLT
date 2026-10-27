import type { Metadata } from "next";
import { MyBookings } from "@/components/booking/my-bookings";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My bookings" };

export default function MyBookingsPage() {
  return (
    <>
      <PageHeader title="My bookings" description="Your charging slots, their status, and cancellation. Bookings are found by their code; no account is needed." />
      <MyBookings />
    </>
  );
}
