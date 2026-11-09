import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile · OneTableCircle" };

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <ProfileForm />
    </main>
  );
}
