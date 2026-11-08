import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('renders the app heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Stagehand' })).toBeDefined();
  });
});
