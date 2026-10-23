import { mount } from 'svelte'
import App from './App.svelte'
import '../../shared/style.css'

const target = document.getElementById('app')
if (!target) throw new Error('Missing app mount point')
mount(App, { target })
