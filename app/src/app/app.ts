import { Component, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  IonApp,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
  IonSpinner,
  IonContent,
} from '@ionic/angular/standalone';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

type TreeNode = {
  name: string;
  type: 'dir' | 'file';
  path: string;
  children?: TreeNode[];
};

const API = 'http://localhost:3001/api';

@Component({
  selector: 'app-root',
  imports: [FormsModule, NgTemplateOutlet, IonApp, IonHeader, IonToolbar, IonTitle, IonButton, IonSpinner, IonContent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  tree = signal<TreeNode[]>([]);
  expanded = signal<Set<string>>(new Set());
  selectedPath = signal<string | null>(null);
  markdown = signal<string>('');
  originalMarkdown = signal<string>('');
  // ETag of the version currently in the editor. Sent as If-Match on save so
  // the server can reject writes that would clobber an external edit.
  currentEtag = signal<string | null>(null);
  // True when SSE reported a change to the open file after we last loaded it.
  externallyChanged = signal(false);

  pdfUrl = signal<SafeResourceUrl | null>(null);
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);

  dirty = computed(() => this.markdown() !== this.originalMarkdown());

  private events: EventSource | null = null;

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  ngOnInit() {
    this.loadTree();
    this.connectEvents();
  }

  ngOnDestroy() {
    this.events?.close();
  }

  private connectEvents() {
    this.events = new EventSource(`${API}/events`);
    this.events.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as { type: string; path?: string };
        if (evt.type === 'tree-changed') {
          this.loadTree();
        } else if (evt.type === 'doc-changed' && evt.path === this.selectedPath()) {
          // Clean editor → silently reload. Dirty editor → flag for the user.
          if (this.dirty()) this.externallyChanged.set(true);
          else this.reloadCurrent();
        }
      } catch { /* ignore malformed events */ }
    };
    this.events.onerror = () => {
      // EventSource auto-reconnects; only surface persistent failures.
      // Silence transient drops to avoid spamming the UI on dev-server reloads.
    };
  }

  loadTree() {
    this.http.get<TreeNode[]>(`${API}/tree`).subscribe({
      next: (t) => this.tree.set(t),
      error: () => this.error.set('Tree konnte nicht geladen werden'),
    });
  }

  toggleDir(path: string) {
    const next = new Set(this.expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.expanded.set(next);
  }

  isExpanded(path: string): boolean {
    return this.expanded().has(path);
  }

  selectFile(path: string) {
    if (this.dirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    this.error.set(null);
    this.externallyChanged.set(false);
    this.http
      .get(`${API}/doc`, { params: { path }, responseType: 'text', observe: 'response' })
      .subscribe({
        next: (resp) => {
          this.markdown.set(resp.body ?? '');
          this.originalMarkdown.set(resp.body ?? '');
          this.currentEtag.set(resp.headers.get('ETag'));
          this.selectedPath.set(path);
          this.pdfUrl.set(null);
        },
        error: (err) => this.error.set(err.error?.error ?? 'Datei konnte nicht geladen werden'),
      });
  }

  // Force-reload the current file from disk, discarding the in-memory copy.
  reloadCurrent() {
    const path = this.selectedPath();
    if (!path) return;
    this.error.set(null);
    this.externallyChanged.set(false);
    this.http
      .get(`${API}/doc`, { params: { path }, responseType: 'text', observe: 'response' })
      .subscribe({
        next: (resp) => {
          this.markdown.set(resp.body ?? '');
          this.originalMarkdown.set(resp.body ?? '');
          this.currentEtag.set(resp.headers.get('ETag'));
        },
        error: (err) => this.error.set(err.error?.error ?? 'Reload fehlgeschlagen'),
      });
  }

  save() {
    const path = this.selectedPath();
    if (!path) return;
    this.saving.set(true);
    this.error.set(null);
    const etag = this.currentEtag();
    const headers = etag ? new HttpHeaders({ 'If-Match': etag }) : undefined;
    this.http
      .put<{ ok: boolean; etag: string }>(
        `${API}/doc`,
        { path, content: this.markdown() },
        { headers, observe: 'response' },
      )
      .subscribe({
        next: (resp) => {
          this.originalMarkdown.set(this.markdown());
          this.currentEtag.set(resp.headers.get('ETag') ?? resp.body?.etag ?? null);
          this.externallyChanged.set(false);
          this.saving.set(false);
        },
        error: (err) => {
          if (err.status === 409) {
            this.externallyChanged.set(true);
            this.error.set('Konflikt: Datei wurde extern geändert. Mit "Externe Version laden" verwerfen oder erneut speichern (überschreibt).');
            // Adopt the server's new ETag so a second save can force-overwrite.
            const newEtag = err.headers?.get?.('ETag') ?? err.error?.currentEtag ?? null;
            this.currentEtag.set(newEtag);
          } else {
            this.error.set(err.error?.error ?? 'Speichern fehlgeschlagen');
          }
          this.saving.set(false);
        },
      });
  }

  generate() {
    const path = this.selectedPath();
    if (!path) return;
    if (this.dirty() && !confirm('Ungespeicherte Änderungen erst speichern?')) return;
    if (this.dirty()) {
      this.save();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.http
      .post(`${API}/pdf`, { path }, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          this.loading.set(false);
        },
        error: (err) => {
          if (err.error instanceof Blob) {
            err.error.text().then((text: string) => {
              try { this.error.set(JSON.parse(text).error); } catch { this.error.set('Server-Fehler'); }
            });
          } else {
            this.error.set(err.error?.error ?? 'Server nicht erreichbar');
          }
          this.loading.set(false);
        },
      });
  }

  onMarkdownChange(value: string) {
    this.markdown.set(value);
  }
}
