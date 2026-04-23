import { Component, signal, ElementRef, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  imports: [FormsModule, IonicModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  @ViewChild('pdfFrame') pdfFrame!: ElementRef<HTMLIFrameElement>;

  markdown = signal(`# Angebot Beispielprojekt

Datum: 23.04.2026
Erstellt für: Musterfirma GmbH

---

## Überblick

| Baustein | Inhalt | Status | Aufwand |
|---|---|---|---|
| 1. Grundstruktur | Setup + Architektur | offen | 1 Woche |
| 2. Kernfunktion | Hauptfeature | offen | 2 Wochen |

## Baustein 1 — Grundstruktur

Ziel: Lauffähige Basis mit definierten Schnittstellen.

### Was ist enthalten

| Leistung | Beschreibung |
|---|---|
| Projektsetup | Ordnerstruktur, Versionierung |
| Datenmodell | Definition der Kernentitäten |

### Nicht enthalten

- Anbindung externer Dienste
`);

  pdfUrl = signal<SafeResourceUrl | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  generate() {
    this.loading.set(true);
    this.error.set(null);

    this.http
      .post('http://localhost:3001/generate', { markdown: this.markdown() }, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.error ?? 'Server nicht erreichbar');
          this.loading.set(false);
        },
      });
  }

  onMarkdownChange(value: string) {
    this.markdown.set(value);
  }
}
