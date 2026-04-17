import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VibeButton from '../components/ui/Button';
import GlassCard from '../components/ui/Card';

describe('UI Components', () => {
  describe('VibeButton', () => {
    it('renders with children', () => {
      render(<VibeButton>Click Me</VibeButton>);
      expect(screen.getByText('Click Me')).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
      const handleClick = vi.fn();
      render(<VibeButton onClick={handleClick}>Click Me</VibeButton>);
      fireEvent.click(screen.getByText('Click Me'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('is disabled when loading', () => {
      render(<VibeButton loading>Click Me</VibeButton>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('GlassCard', () => {
    it('renders children', () => {
      render(
        <GlassCard>
          <div data-testid="card-content">Card content</div>
        </GlassCard>
      );
      expect(screen.getByTestId('card-content')).toBeInTheDocument();
    });
  });
});
