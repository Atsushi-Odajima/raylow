import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './layout/RequireAuth';
import { LoadingState } from './components/States';

// 画面は遅延読み込み（初期バンドル縮小）。静的 shell は SW が cache-first で保持する
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AuthExpiredPage = lazy(() => import('./pages/AuthExpiredPage').then((m) => ({ default: m.AuthExpiredPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const CreatePage = lazy(() => import('./pages/CreatePage').then((m) => ({ default: m.CreatePage })));
const SetupPage = lazy(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const TemplateImportPage = lazy(() => import('./pages/TemplateImportPage').then((m) => ({ default: m.TemplateImportPage })));
const TemplateVersionPage = lazy(() => import('./pages/TemplateVersionPage').then((m) => ({ default: m.TemplateVersionPage })));
const DraftNewPage = lazy(() => import('./pages/DraftNewPage').then((m) => ({ default: m.DraftNewPage })));
const DraftEditPage = lazy(() => import('./pages/DraftEditPage').then((m) => ({ default: m.DraftEditPage })));
const DraftCheckPage = lazy(() => import('./pages/DraftCheckPage').then((m) => ({ default: m.DraftCheckPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const ReviewDetailPage = lazy(() => import('./pages/ReviewDetailPage').then((m) => ({ default: m.ReviewDetailPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const DocumentOutputPage = lazy(() => import('./pages/DocumentOutputPage').then((m) => ({ default: m.DocumentOutputPage })));
const PhrasesPage = lazy(() => import('./pages/PhrasesPage').then((m) => ({ default: m.PhrasesPage })));
const BatchNewPage = lazy(() => import('./pages/BatchNewPage').then((m) => ({ default: m.BatchNewPage })));
const BatchDetailPage = lazy(() => import('./pages/BatchDetailPage').then((m) => ({ default: m.BatchDetailPage })));
const MattersPage = lazy(() => import('./pages/MattersPage').then((m) => ({ default: m.MattersPage })));
const MatterDetailPage = lazy(() => import('./pages/MatterDetailPage').then((m) => ({ default: m.MatterDetailPage })));
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const EvidencePage = lazy(() => import('./pages/EvidencePage').then((m) => ({ default: m.EvidencePage })));
const PacketNewPage = lazy(() => import('./pages/PacketNewPage').then((m) => ({ default: m.PacketNewPage })));
const PacketDetailPage = lazy(() => import('./pages/PacketDetailPage').then((m) => ({ default: m.PacketDetailPage })));
const DispatchNewPage = lazy(() => import('./pages/DispatchNewPage').then((m) => ({ default: m.DispatchNewPage })));
const DispatchDetailPage = lazy(() => import('./pages/DispatchDetailPage').then((m) => ({ default: m.DispatchDetailPage })));
const JobPage = lazy(() => import('./pages/JobPage').then((m) => ({ default: m.JobPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
              <LoadingState label="画面を読み込んでいます…" />
            </div>
          }
        >
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/expired" element={<AuthExpiredPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/create" replace />} />
              <Route path="/create" element={<CreatePage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/templates/import" element={<TemplateImportPage />} />
              <Route path="/templates/:id/versions/:v" element={<TemplateVersionPage />} />
              <Route path="/drafts/new" element={<DraftNewPage />} />
              <Route path="/drafts/:id/edit" element={<DraftEditPage />} />
              <Route path="/drafts/:id/check" element={<DraftCheckPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/reviews/:id" element={<ReviewDetailPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/documents/:id/output" element={<DocumentOutputPage />} />
              <Route path="/phrases" element={<PhrasesPage />} />
              <Route path="/batches/new" element={<BatchNewPage />} />
              <Route path="/batches/:id" element={<BatchDetailPage />} />
              <Route path="/matters" element={<MattersPage />} />
              <Route path="/matters/:id" element={<MatterDetailPage />} />
              <Route path="/matters/:id/evidence" element={<EvidencePage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/packets/new" element={<PacketNewPage />} />
              <Route path="/packets/:id" element={<PacketDetailPage />} />
              <Route path="/dispatches/new" element={<DispatchNewPage />} />
              <Route path="/dispatches/:id" element={<DispatchDetailPage />} />
              <Route path="/jobs/:id" element={<JobPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
