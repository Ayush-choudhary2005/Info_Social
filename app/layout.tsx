import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Field Notes — science, history and news in short reads',
  description:
    'A calm, ad-free feed of short, sourced facts. Read a few, then get on with your day.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
