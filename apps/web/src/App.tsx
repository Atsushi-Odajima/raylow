import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './layout/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { AuthExpiredPage } from './pages/AuthExpiredPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { CreatePage } from './pages/CreatePage';
import { SetupPage } from './pages/SetupPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TemplateImportPage } from './pages/TemplateImportPage';
import { TemplateVersionPage } from './pages/TemplateVersionPage';
import { DraftNewPage } from './pages/DraftNewPage';
import { DraftEditPage } from './pages/DraftEditPage';
import { DraftCheckPage } from './pages/DraftCheckPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { ReviewDetailPage } from './pages/ReviewDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { DocumentOutputPage } from './pages/DocumentOutputPage';
import { PhrasesPage } from './pages/PhrasesPage';
import { BatchNewPage } from './pages/BatchNewPage';
import { BatchDetailPage } from './pages/BatchDetailPage';
import { MattersPage } from './pages/MattersPage';
import { MatterDetailPage } from './pages/MatterDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { EvidencePage } from './pages/EvidencePage';
import { PacketNewPage } from './pages/PacketNewPage';
import { PacketDetailPage } from './pages/PacketDetailPage';
import { DispatchNewPage } from './pages/DispatchNewPage';
import { DispatchDetailPage } from './pages/DispatchDetailPage';
import { JobPage } from './pages/JobPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}
