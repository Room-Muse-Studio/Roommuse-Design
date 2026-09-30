'use client';

import ProjectsGallery from '@/components/ProjectsGallery';
import { useAuth } from '@/components/useAuth';
import { useEffect } from 'react';

const toSignIn = () => window.location.replace('/');

export default function ProjectsPage() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) toSignIn();
  }, [loading, user]);
  if (!user) {
    return (
      <main className="centered">
        <div className="spinner" aria-label="Loading" />
      </main>
    );
  }
  return <ProjectsGallery user={user} onSignedOut={toSignIn} />;
}
