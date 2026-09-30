import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RoomMuse viewer',
  description: 'Scanned rooms in 3D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
