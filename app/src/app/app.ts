import { Component, signal, computed, OnInit } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
export class App implements OnInit {
  tree = signal<TreeNode[]>([]);
  expanded = signal<Set<string>>(new Set());
  selectedPath = signal<string | null>(null);
  markdown = signal<string>('');
  originalMarkdown = signal<string>('');

  pdfUrl = signal<SafeResourceUrl | null>(null);
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);

  dirty = computed(() => this.markdown() !== this.originalMarkdown());

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  ngOnInit() {
    this.loadTree();
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
    this.http
      .get(`${API}/doc`, { params: { path }, responseType: 'text' })
      .subscribe({
        next: (text) => {
          this.markdown.set(text);
          this.originalMarkdown.set(text);
          this.selectedPath.set(path);
          this.pdfUrl.set(null);
        },
        error: (err) => this.error.set(err.error?.error ?? 'Datei konnte nicht geladen werden'),
      });
  }

  save() {
    const path = this.selectedPath();
    if (!path) return;
    this.saving.set(true);
    this.error.set(null);
    this.http
      .put(`${API}/doc`, { path, content: this.markdown() })
      .subscribe({
        next: () => {
          this.originalMarkdown.set(this.markdown());
          this.saving.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error ?? 'Speichern fehlgeschlagen');
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
