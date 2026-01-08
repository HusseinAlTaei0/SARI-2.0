import React, { useEffect, useRef } from 'react';

export const SilkBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let animationFrameId: number;
    let time = 0;

    // Configuration for the silk waves
    // Keeping color compatible with Tailwind 'sari-purple': #7C3AED (R:124, G:58, B:237)
    const lines = 3; 
    const waveSpeed = 0.002;
    const waveAmplitude = 50;
    
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener('resize', resize);
    resize();

    const draw = () => {
      // Clear with transparency to create trails or just solid clear for sharp lines
      // Using 'sari-dark' #020204
      ctx.fillStyle = '#020204';
      ctx.fillRect(0, 0, width, height);

      // Draw waves
      // We create a "silk" effect by drawing multiple sine waves with slightly offset phases and frequencies
      
      // Global composition operation to make overlapping lines glow
      ctx.globalCompositeOperation = 'screen'; 

      for (let j = 0; j < lines; j++) {
        ctx.beginPath();
        
        // Gradient for the line
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(124, 58, 237, 0)');
        gradient.addColorStop(0.5, `rgba(124, 58, 237, ${0.15 + (j * 0.05)})`); // sari-purple
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0)');
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2 + j;

        for (let x = 0; x <= width; x += 5) {
          // Complex wave function
          // y = Center + Sine(Frequency) + Sine(Modulation)
          const y = (height / 2) + 
                    Math.sin(x * 0.003 + time + j) * waveAmplitude * 2 + 
                    Math.sin(x * 0.01 + time * 1.5 + j) * waveAmplitude;
          
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Reset composite operation
      ctx.globalCompositeOperation = 'source-over';

      time += waveSpeed;
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};