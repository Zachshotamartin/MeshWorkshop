import { mountLab } from '@zachshotamartin/graphics-workbench';
import '@zachshotamartin/graphics-workbench/style.css';
import { createExperiment, metadata } from './src/index.js';
document.querySelector('h1').textContent=metadata.title;
document.querySelector('#description').textContent=metadata.description;
mountLab(document.querySelector('#lab'), createExperiment);
